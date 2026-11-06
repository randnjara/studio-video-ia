"""Transcription horodatée découpée en répliques de 5 s au plus, avec des indices du ton lus dans l'audio.

Pour un nouveau projet sans tableau : la voix off audio est découpée aux fins de phrases et aux pauses, et chaque réplique
reçoit des indices mesurés (débit, pause avant, volume, montée ou descente de la voix en fin de réplique, variation de
la hauteur). Un ton est déduit de ces indices (calme, joyeux, ému, rieur, interrogatif) : il guide l'intention et les
gestes que l'assistant écrit dans le tableau.

repliques() et ton() sont sans modèle : testées avec des mots et des indices inventés.
"""

import re

import numpy as np

DUREE_MAX = 5.0
PAUSE_COUPURE = 0.35  # pause qui termine une réplique (si elle dure déjà 1,5 s)
DUREE_MIN_AVANT_PAUSE = 1.5
FIN_DE_PHRASE = re.compile(r"[.!?…]$")


def repliques(mots, duree_max=DUREE_MAX):
    """Regroupe les mots en répliques : fin de phrase, ou pause d'au moins 0,35 s après 1,5 s, ou 5 s atteintes (coupure
    alors à la plus longue pause de la réplique). Renvoie [{"debut", "fin", "texte", "mots": [...]}]."""
    groupes, courant = [], []

    def fermer(jusqua=None):
        nonlocal courant
        if not courant:
            return
        garde = courant if jusqua is None else courant[:jusqua]
        reste = [] if jusqua is None else courant[jusqua:]
        groupes.append(garde)
        courant = reste

    for m in mots:
        if courant and m["fin"] - courant[0]["debut"] > duree_max:
            # Trop long : coupure à la plus longue pause (après au moins un mot)
            pauses = [(courant[k + 1]["debut"] - courant[k]["fin"], k + 1) for k in range(len(courant) - 1)]
            fermer(max(pauses)[1] if pauses else None)
        if courant:
            pause = m["debut"] - courant[-1]["fin"]
            if pause >= PAUSE_COUPURE and courant[-1]["fin"] - courant[0]["debut"] >= DUREE_MIN_AVANT_PAUSE:
                fermer()
        courant.append(m)
        if FIN_DE_PHRASE.search(m["mot"]):
            fermer()
    fermer()
    return [
        {"debut": g[0]["debut"], "fin": g[-1]["fin"], "texte": " ".join(x["mot"] for x in g).strip(), "mots": g}
        for g in groupes
        if g
    ]


def indices(son, frequence, debut, fin, pause_avant, nb_mots, volume_median_db):
    """Mesures d'une réplique dans l'audio (son mono float32)."""
    a, b = int(debut * frequence), max(int(debut * frequence) + 1, int(fin * frequence))
    extrait = son[a:b]
    duree = max(0.05, fin - debut)
    rms = float(np.sqrt(np.mean(extrait.astype(np.float64) ** 2))) if extrait.size else 0.0
    volume_db = 20 * np.log10(max(rms, 1e-6))
    hauteur = _hauteur(extrait, frequence)
    return {
        "debit": round(nb_mots / duree, 2),
        "pause_avant": round(max(0.0, pause_avant), 2),
        "volume": round(volume_db - volume_median_db, 1),
        "pente": hauteur["pente"],
        "variation": hauteur["variation"],
    }


def _hauteur(extrait, frequence):
    """Montée ou descente de la voix en fin de réplique (en % de la hauteur moyenne) et variation de la hauteur."""
    try:
        import librosa

        if extrait.size < frequence * 0.3:
            return {"pente": 0.0, "variation": 0.0}
        f0, voise, _ = librosa.pyin(extrait, fmin=70, fmax=400, sr=frequence, frame_length=1024)
        f0 = f0[voise & ~np.isnan(f0)] if voise is not None else f0[~np.isnan(f0)]
        if f0.size < 6:
            return {"pente": 0.0, "variation": 0.0}
        moyenne = float(np.mean(f0))
        tiers = max(2, f0.size // 3)
        pente = (float(np.mean(f0[-tiers:])) - float(np.mean(f0[:-tiers]))) / moyenne * 100
        return {"pente": round(pente, 1), "variation": round(float(np.std(f0)) / moyenne, 3)}
    except Exception:
        return {"pente": 0.0, "variation": 0.0}


def ton(texte, i):
    """Ton déduit des indices : interrogatif, rieur, joyeux, ému ou calme."""
    if texte.strip().endswith("?") or i["pente"] >= 8:
        return "interrogatif"
    if i["variation"] >= 0.3 and i["volume"] >= 2:
        return "rieur"
    if i["debit"] >= 2.8 and (i["volume"] >= 1 or i["variation"] >= 0.18):
        return "joyeux"
    if i["debit"] < 2.0 and (i["pause_avant"] >= 0.6 or i["volume"] <= -3 or i["pente"] <= -10):
        return "ému"
    return "calme"


def description(i):
    """Indices en français, pour la consigne de l'assistant."""
    morceaux = [f"débit {i['debit']:.1f} mots/s".replace(".", ",")]
    if i["pause_avant"] >= 0.3:
        morceaux.append(f"pause de {i['pause_avant']:.1f} s avant".replace(".", ","))
    if i["volume"] >= 2:
        morceaux.append(f"voix plus forte (+{i['volume']:.0f} dB)")
    elif i["volume"] <= -2:
        morceaux.append(f"voix plus douce ({i['volume']:.0f} dB)")
    if i["pente"] >= 8:
        morceaux.append("finit en montant")
    elif i["pente"] <= -8:
        morceaux.append("finit en descendant")
    if i["variation"] >= 0.2:
        morceaux.append("voix très mélodieuse")
    return ", ".join(morceaux)


def transcrire(son, frequence, mots, duree_max=DUREE_MAX):
    """Répliques avec leurs indices et leur ton : [{"debut", "fin", "texte", "ton", "indices", "description"}]."""
    groupes = repliques(mots, duree_max)
    volumes = []
    for g in groupes:
        a, b = int(g["debut"] * frequence), max(int(g["debut"] * frequence) + 1, int(g["fin"] * frequence))
        x = son[a:b]
        volumes.append(20 * np.log10(max(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) if x.size else 0.0, 1e-6)))
    mediane = float(np.median(volumes)) if volumes else 0.0
    sortie = []
    for k, g in enumerate(groupes):
        pause = g["debut"] - groupes[k - 1]["fin"] if k else g["debut"]
        i = indices(son, frequence, g["debut"], g["fin"], pause, len(g["mots"]), mediane)
        sortie.append(
            {
                "debut": round(g["debut"], 2),
                "fin": round(g["fin"], 2),
                "texte": g["texte"],
                "ton": ton(g["texte"], i),
                "indices": i,
                "description": description(i),
            }
        )
    return sortie
