"""Découpe de la voix off en un morceau par plan, pour le lip-sync.

La voix off entière est d'abord convertie par ffmpeg en WAV 16 kHz mono (ce qu'attend le modèle lip-sync), puis chaque
morceau est pris à l'échantillon près entre son début et sa fin : les morceaux mis bout à bout redonnent exactement la
voix off, sans trou ni chevauchement.

Sans recalage, les temps reçus sont pris tels quels (aucune mise à l'échelle). Les plans qui commencent après la fin de
la voix off sont ignorés (pas de morceau) ; le dernier plan à moitié couvert est coupé à la fin de la voix.

Recalage (option) : quand la durée réelle de la voix diffère du minutage du tableau (voix plus lente ou plus rapide que
prévu), les temps du tableau sont d'abord mis à l'échelle, puis chaque coupure est déplacée vers le silence le plus
proche entre deux mots (mots repérés par Whisper, silences repérés par ffmpeg), pour ne jamais couper un mot.
Au-delà de 20 % d'écart, la voix ne correspond pas à ces plans (voix d'une partie du film seulement, autre voix…) :
rien n'est mis à l'échelle, les coupures sont seulement posées dans les silences proches, et un avertissement est rendu.
"""

import os
import re
import subprocess

import numpy as np
import soundfile as sf

FREQUENCE = 16000
# Écart de durée à partir duquel le minutage du tableau est recalé (2 %)
ECART_MAX = 0.02
# Au-delà de cet écart, la voix n'est jamais étirée ni comprimée (20 %)
ECART_ECHELLE_MAX = 0.20
# Morceau le plus court gardé (s) : en dessous, le plan est considéré sans voix
MORCEAU_MIN_S = 0.1
# Distance maximale entre une coupure prévue et le silence où elle est déplacée
FENETRE_S = 0.6
WHISPER = os.environ.get("WHISPER_MODEL", "small")
# Langues comprises par Whisper (les codes du studio commencent par ces deux lettres)
LANGUES_WHISPER = {
    "af", "ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "mg", "ms", "nl", "pt", "ru", "sw", "tr", "zh",
}

_transcriptions = {}


def en_wav_16k(source, sortie):
    """Décode n'importe quel son (WAV, MP3, M4A, WebM…) en WAV 16 kHz mono 16 bits."""
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", source, "-vn", "-ac", "1", "-ar", str(FREQUENCE), "-c:a", "pcm_s16le", sortie],
        check=True,
    )
    son, frequence = sf.read(sortie, dtype="float32")
    if son.ndim > 1:
        son = son.mean(axis=1)
    return son, frequence


def silences(chemin, seuil_db=-35, duree_min=0.12):
    """Silences repérés par ffmpeg (silencedetect) : liste de (début, fin) en secondes."""
    sortie = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", chemin, "-af", f"silencedetect=noise={seuil_db}dB:d={duree_min}", "-f", "null", "-"],
        capture_output=True,
        text=True,
    ).stderr
    debuts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", sortie)]
    fins = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", sortie)]
    return [(max(0.0, d), f) for d, f in zip(debuts, fins) if f > d]


def modele_whisper(nom=WHISPER):
    """Modèle Whisper gardé en mémoire (carte graphique, sinon processeur). None si faster-whisper manque."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    cle = f"__modele__{nom}"
    if cle not in _transcriptions:
        try:
            _transcriptions[cle] = WhisperModel(nom, device="cuda", compute_type="float16")
        except Exception:
            _transcriptions[cle] = WhisperModel(nom, device="cpu", compute_type="int8")
    return _transcriptions[cle]


def mots_whisper(chemin, langue, prompt=None, nom=WHISPER):
    """Mots prononcés avec leur horodatage : [{"mot", "debut", "fin"}] (le mot garde sa ponctuation).
    « prompt » : texte attendu (les répliques des plans), qui aide Whisper à reconnaître les mots."""
    modele = modele_whisper(nom)
    if modele is None:
        raise RuntimeError("Whisper (faster-whisper) n'est pas installé sur le serveur voix.")
    segments, _ = modele.transcribe(
        chemin,
        language=langue if langue in LANGUES_WHISPER else None,
        word_timestamps=True,
        vad_filter=False,
        initial_prompt=(prompt or None),
        condition_on_previous_text=True,
    )
    return [
        {"mot": m.word.strip(), "debut": float(m.start), "fin": float(m.end)}
        for s in segments
        for m in (s.words or [])
        if m.word.strip()
    ]


def pauses_whisper(chemin, langue, cle):
    """Pauses entre deux mots, repérées par Whisper (horodatage de chaque mot). Vide si Whisper n'est pas disponible."""
    if cle in _transcriptions:
        return _transcriptions[cle]
    try:
        mots = mots_whisper(chemin, langue)
    except RuntimeError:
        return []
    pauses = [(a["fin"], b["debut"]) for a, b in zip(mots, mots[1:]) if b["debut"] - a["fin"] >= 0.04]
    _transcriptions[cle] = pauses
    return pauses


def recaler(bornes, duree_reelle, fin_prevue, coupures, echelle=None):
    """Met les coupures à l'échelle de la durée réelle (ou de « echelle » si elle est donnée, 1 = pas de mise à
    l'échelle), puis les déplace vers la pause la plus proche (± FENETRE_S)."""
    if echelle is None:
        echelle = duree_reelle / fin_prevue if fin_prevue > 0 else 1.0
    milieux = sorted((a + b) / 2 for a, b in coupures)
    resultat = {}
    for b in sorted(bornes):
        x = b * echelle
        if b <= 0:
            resultat[b] = 0.0
            continue
        proches = [m for m in milieux if abs(m - x) <= FENETRE_S]
        if proches:
            x = min(proches, key=lambda m: abs(m - x))
        resultat[b] = min(max(0.0, x), duree_reelle)
    # Les coupures restent dans l'ordre
    precedente = 0.0
    for b in sorted(resultat):
        resultat[b] = max(resultat[b], precedente)
        precedente = resultat[b]
    return resultat


def ecart(duree_reelle, fin_prevue):
    return abs(duree_reelle - fin_prevue) / fin_prevue if fin_prevue > 0 else 0.0


def decouper(son, frequence, morceaux, dossier):
    """Écrit chaque morceau (WAV 16 kHz mono 16 bits). Renvoie ([(morceau, chemin local, début, fin, durée)], plans
    ignorés) : un plan qui tombe après la fin de la voix (ou dont il resterait moins de MORCEAU_MIN_S) n'a pas de morceau,
    sans faire échouer les autres."""
    total = len(son)
    sortie, ignores = [], []
    for i, m in enumerate(morceaux):
        a = max(0, min(total, round(m["debut"] * frequence)))
        b = max(0, min(total, round(m["fin"] * frequence)))
        if b - a < round(MORCEAU_MIN_S * frequence):
            ignores.append(m["scene_id"])
            continue
        chemin = os.path.join(dossier, f"morceau-{i}.wav")
        sf.write(chemin, son[a:b], frequence, subtype="PCM_16")
        sortie.append((m, chemin, a / frequence, b / frequence, (b - a) / frequence))
    return sortie, ignores


def preparer(source, morceaux, fin_prevue, recalage, langue, cle, dossier):
    """Décode la voix, recale le minutage si demandé, et découpe.
    Renvoie {"decoupes", "ignores" (plans sans voix), "recale" (bool), "avertissement" (texte ou None), "duree"}."""
    wav = os.path.join(dossier, "voix-16k.wav")
    son, frequence = en_wav_16k(source, wav)
    duree = len(son) / frequence
    recale = False
    avertissement = None
    morceaux = [dict(m) for m in morceaux]
    e = ecart(duree, fin_prevue)
    if recalage and e > ECART_MAX:
        echelle = None
        if e > ECART_ECHELLE_MAX:
            # Voix bien plus courte (ou plus longue) que ces plans : on ne l'étire jamais
            echelle = 1.0
            avertissement = (
                f"La voix off ({duree:.1f} s) et les plans ({fin_prevue:.1f} s) diffèrent de {e * 100:.0f} % : "
                "pas de mise à l'échelle, coupures seulement posées dans les silences proches."
            )
        coupures = silences(wav) + pauses_whisper(wav, langue, cle)
        bornes = {m["debut"] for m in morceaux} | {m["fin"] for m in morceaux}
        nouvelles = recaler(bornes, duree, fin_prevue, coupures, echelle)
        for m in morceaux:
            m["debut"], m["fin"] = nouvelles[m["debut"]], nouvelles[m["fin"]]
        recale = True
    # Le dernier plan à moitié couvert s'arrête à la fin de la voix ; ceux d'après sont ignorés par decouper()
    for m in morceaux:
        m["fin"] = min(m["fin"], duree)
    decoupes, ignores = decouper(son, frequence, morceaux, dossier)
    return {"decoupes": decoupes, "ignores": ignores, "recale": recale, "avertissement": avertissement, "duree": duree}
