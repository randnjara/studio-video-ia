"""Serveur RunPod du studio voix, séparé du serveur vidéo (petite carte graphique, ses propres versions de bibliothèques).

Trois façons de dire un texte :
- « mms » : Meta MMS, la seule voix libre qui parle vraiment malgache (code mlg), usage non commercial ;
- « kokoro » : une cinquantaine de voix toutes prêtes (anglais, français, espagnol, chinois…), licence Apache 2.0 ;
- « chatterbox » : Chatterbox multilingue (23 langues, licence MIT), émotion réglable, et copie d'une voix à partir
  d'un enregistrement de quelques secondes.

Et une façon de changer une voix : « conversion » (Chatterbox VC) garde les mots et l'intonation d'un enregistrement
et lui donne le timbre d'une autre voix. Elle ne dépend pas de la langue : c'est elle qui donne au malgache la voix
d'une personne (MMS dit le texte, puis la conversion lui donne la voix voulue).

Le résultat (WAV) est déposé directement dans le stockage Supabase grâce au lien d'envoi fourni par le site.
"""

import os
import re
import tempfile
import time
import traceback
from io import BytesIO

import numpy as np
import requests
import runpod
import soundfile as sf
import torch

APPAREIL = "cuda" if torch.cuda.is_available() else "cpu"
# Langues comprises par Chatterbox multilingue
LANGUES_CHATTERBOX = {
    "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja",
    "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
}
# Première lettre du nom d'une voix Kokoro = sa langue (a : anglais US, b : anglais UK, f : français…)
LANGUES_KOKORO = {"a", "b", "e", "f", "h", "i", "p", "z"}
TEXTE_MAX = 5000
PAUSE_S = 0.3

EN_MEMOIRE = {}


def modele(nom, charger):
    """Garde chaque modèle en mémoire après son premier usage (ils tiennent tous ensemble sur la carte)."""
    if nom not in EN_MEMOIRE:
        debut = time.time()
        EN_MEMOIRE[nom] = charger()
        print(f"{nom} prêt en {time.time() - debut:.0f} s")
    return EN_MEMOIRE[nom]


def phrases(texte, longueur=280):
    """Découpe le texte en morceaux courts : les modèles disent mieux une phrase à la fois."""
    morceaux = []
    for ligne in texte.splitlines():
        actuel = ""
        for phrase in re.split(r"(?<=[.!?;…])\s+", ligne.strip()):
            if not phrase:
                continue
            if actuel and len(actuel) + len(phrase) + 1 > longueur:
                morceaux.append(actuel)
                actuel = phrase
            else:
                actuel = f"{actuel} {phrase}".strip()
        if actuel:
            morceaux.append(actuel)
    return morceaux


def assembler(parties, frequence):
    """Met les morceaux bout à bout, avec un petit silence entre deux phrases."""
    silence = np.zeros(int(PAUSE_S * frequence), dtype=np.float32)
    son = []
    for i, p in enumerate(parties):
        if i:
            son.append(silence)
        son.append(np.asarray(p, dtype=np.float32).reshape(-1))
    return np.concatenate(son) if son else np.zeros(1, dtype=np.float32)


def decouper(son, frequence, longueur_s=20.0):
    """Coupe un long enregistrement en morceaux d'environ 20 s, là où la voix se tait le plus."""
    pas = int(longueur_s * frequence)
    if len(son) <= pas * 1.5:
        return [son]
    fenetre = int(0.05 * frequence)
    morceaux, debut = [], 0
    while len(son) - debut > pas * 1.5:
        # Cherche le moment le plus calme entre 18 et 22 s après le début du morceau
        zone = son[debut + pas - 2 * frequence : debut + pas + 2 * frequence]
        energies = [float(np.mean(zone[i : i + fenetre] ** 2)) for i in range(0, len(zone) - fenetre, fenetre)]
        coupe = debut + pas - 2 * frequence + int(np.argmin(energies)) * fenetre
        morceaux.append(son[debut:coupe])
        debut = coupe
    morceaux.append(son[debut:])
    return morceaux


def dire_mms(texte, code, seed):
    from transformers import AutoTokenizer, VitsModel

    def charger():
        depot = f"facebook/mms-tts-{code}"
        return VitsModel.from_pretrained(depot).to(APPAREIL).eval(), AutoTokenizer.from_pretrained(depot)

    vits, jetons = modele(f"mms-{code}", charger)
    torch.manual_seed(seed)
    parties = []
    for morceau in phrases(texte):
        entree = jetons(morceau, return_tensors="pt").to(APPAREIL)
        if entree["input_ids"].shape[-1] == 0:
            continue
        with torch.no_grad():
            parties.append(vits(**entree).waveform[0].cpu().numpy())
    return parties, vits.config.sampling_rate


def dire_kokoro(texte, voix):
    from kokoro import KModel, KPipeline

    langue = voix[:1]
    if langue not in LANGUES_KOKORO:
        raise ValueError(f"Voix Kokoro inconnue : {voix}")
    reseau = modele("kokoro", lambda: KModel(repo_id="hexgrad/Kokoro-82M").to(APPAREIL).eval())
    lecteur = modele(f"kokoro-{langue}", lambda: KPipeline(lang_code=langue, repo_id="hexgrad/Kokoro-82M", model=reseau))
    parties = []
    for morceau in phrases(texte):
        audio = [r.audio.cpu().numpy() for r in lecteur(morceau, voice=voix, speed=1) if r.audio is not None]
        if audio:
            parties.append(np.concatenate(audio))
    return parties, 24000


def charger_chatterbox():
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    tts = ChatterboxMultilingualTTS.from_pretrained(device=APPAREIL)
    # Voix d'origine du modèle, remise en place quand on n'utilise pas la voix d'une personne
    return tts, tts.conds


def dire_chatterbox(texte, langue, reference, emotion, seed):
    tts, origine = modele("chatterbox", charger_chatterbox)
    if reference:
        tts.prepare_conditionals(reference, exaggeration=emotion)
    else:
        tts.conds = origine
    torch.manual_seed(seed)
    parties = [
        tts.generate(morceau, language_id=langue, exaggeration=emotion, cfg_weight=0.5).squeeze(0).cpu().numpy()
        for morceau in phrases(texte)
    ]
    return parties, tts.sr


def convertir(parties, frequence, reference, dossier):
    """Donne aux morceaux le timbre de la voix de référence, en gardant les mots et l'intonation."""
    from chatterbox.vc import ChatterboxVC

    vc = modele("chatterbox-vc", lambda: ChatterboxVC.from_pretrained(APPAREIL))
    vc.set_target_voice(reference)
    sortie = []
    for i, morceau in enumerate(parties):
        source = os.path.join(dossier, f"morceau-{i}.wav")
        sf.write(source, morceau, frequence)
        sortie.append(vc.generate(audio=source).squeeze(0).cpu().numpy())
    return sortie, vc.sr


def telecharger(url, chemin):
    reponse = requests.get(url, timeout=120)
    reponse.raise_for_status()
    with open(chemin, "wb") as f:
        f.write(reponse.content)
    # Tout enregistrement (MP3, M4A…) est relu puis gardé en WAV mono, compris par tous les modèles
    import librosa

    son, frequence = librosa.load(chemin, sr=None, mono=True)
    wav = f"{chemin}.wav"
    sf.write(wav, son, frequence)
    return wav, son, frequence


def generer(entree):
    for champ in ("moteur", "upload_url", "audio_path"):
        if not entree.get(champ):
            return {"error": f"Champ manquant : {champ}"}
    moteur = entree["moteur"]
    texte = (entree.get("texte") or "").strip()[:TEXTE_MAX]
    seed = int(entree.get("seed", 0)) % 2**32
    emotion = min(max(float(entree.get("emotion", 0.5)), 0.25), 2.0)

    debut = time.time()
    with tempfile.TemporaryDirectory() as dossier:
        reference = None
        if entree.get("reference_url"):
            reference, _, _ = telecharger(entree["reference_url"], os.path.join(dossier, "reference"))

        if moteur == "conversion":
            if not entree.get("source_url") or not reference:
                return {"error": "Il faut l'enregistrement à transformer et la voix à lui donner."}
            _, son, frequence = telecharger(entree["source_url"], os.path.join(dossier, "enregistrement"))
            parties, frequence = convertir(decouper(son, frequence), frequence, reference, dossier)
            son = np.concatenate(parties)
        else:
            if not texte:
                return {"error": "Le texte est vide."}
            if moteur == "mms":
                parties, frequence = dire_mms(texte, entree.get("modele") or "mlg", seed)
            elif moteur == "kokoro":
                parties, frequence = dire_kokoro(texte, entree.get("modele") or "ff_siwis")
            elif moteur == "chatterbox":
                langue = entree.get("modele") or "fr"
                if langue not in LANGUES_CHATTERBOX:
                    return {"error": f"Chatterbox ne parle pas cette langue : {langue}"}
                parties, frequence = dire_chatterbox(texte, langue, reference, emotion, seed)
                reference = None  # déjà dite avec cette voix
            else:
                return {"error": f"Moteur inconnu : {moteur}"}
            if not parties:
                return {"error": "Aucun mot à dire dans ce texte."}
            # Voix d'une personne dans une langue que Chatterbox ne parle pas (malgache) : chaque phrase est convertie
            if reference:
                parties, frequence = convertir(parties, frequence, reference, dossier)
            son = assembler(parties, frequence)

    # Niveau ramené sous la saturation, puis WAV 16 bits
    pic = float(np.max(np.abs(son))) if son.size else 0.0
    if pic > 0.99:
        son = son * (0.99 / pic)
    tampon = BytesIO()
    sf.write(tampon, son, frequence, format="WAV", subtype="PCM_16")
    secondes = time.time() - debut
    envoi = requests.put(
        entree["upload_url"],
        data=tampon.getvalue(),
        headers={"Content-Type": "audio/wav", "x-upsert": "true"},
        timeout=120,
    )
    if not envoi.ok:
        return {"error": f"Envoi de la voix refusé ({envoi.status_code}) : {envoi.text[:200]}"}
    return {"audio_path": entree["audio_path"], "duree": round(len(son) / frequence, 2), "secondes": round(secondes, 1)}


def handler(job):
    try:
        return generer(job["input"])
    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__} : {e}"[:500]}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
