# Plans calés sur la voix off audio et transcription découpée en répliques avec le ton (sans Whisper : mots inventés).
# Lancer : python3 worker-voix/test_alignement.py (numpy)
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

from alignement import aligner, normaliser  # noqa: E402
from ton import repliques, ton, transcrire  # noqa: E402


def dire(phrases, debit=0.4, pause=0.5, depart=0.3):
    """Mots horodatés : chaque mot dure « debit » s, une pause sépare les phrases."""
    mots, t = [], depart
    for phrase in phrases:
        for m in phrase.split():
            mots.append({"mot": m, "debut": round(t, 3), "fin": round(t + debit * 0.9, 3)})
            t += debit
        t += pause
    return mots, t


assert normaliser("Tonga,") == "tonga" and normaliser("Été!") == "ete"

# 1. Quatre plans, voix réelle plus courte que l'estimation du tableau : chaque plan suit les mots prononcés
repliques_plans = ["Tonga soa daholo ry namana.", "Androany isika hiresaka momba ny reny.", "Ny reny no fototry ny fianakaviana.", "Misaotra anareo."]
plans = [{"scene_id": f"p{i+1}", "texte": t} for i, t in enumerate(repliques_plans)]
mots, fin = dire(repliques_plans)
# Whisper reconnaît « hiresaka » de travers et oublie « daholo »
mots = [dict(m, mot="hiresaky") if m["mot"] == "hiresaka" else m for m in mots if m["mot"] != "daholo"]
r = aligner(plans, mots, fin + 0.4)
print([(x["scene_id"], x["debut"], x["fin"], x["statut"], x["manquants"]) for x in r])
assert r[0]["debut"] == 0 and abs(r[-1]["fin"] - (fin + 0.4)) < 1e-6, "les plans couvrent toute la voix"
for a, b in zip(r, r[1:]):
    assert a["fin"] == b["debut"], "sans trou ni chevauchement"
assert r[0]["manquants"] == ["daholo"] and r[0]["statut"] == "approx"
assert r[1]["statut"] == "approx" and r[1]["trouves"] == r[1]["total"], "mot reconnu de travers accepté"
assert r[2]["statut"] == "ok"
assert r[0]["prononce"] == "Tonga soa ry namana." and r[1]["parole_debut"] > r[0]["fin"] - 0.5, "texte prononcé et instants de parole"
# La coupure entre deux plans tombe dans le silence entre leurs mots
dernier_p1 = max(m["fin"] for m in mots if m["mot"] in ("namana.",))
premier_p2 = min(m["debut"] for m in mots if m["mot"] == "Androany")
assert dernier_p1 < r[0]["fin"] < premier_p2

# 2. Plan introuvable (réplique absente de l'audio) : il prend sa part du silence entre ses voisins
plans2 = plans[:2] + [{"scene_id": "x", "texte": "Teny tsy voalaza mihitsy"}] + plans[2:]
r2 = aligner(plans2, mots, fin + 0.4)
x = next(p for p in r2 if p["scene_id"] == "x")
assert x["statut"] == "non_trouve" and x["trouves"] == 0 and x["duree"] >= 0
assert all(a["fin"] == b["debut"] for a, b in zip(r2, r2[1:]))

# 3. Réplique de plus de 5 s : coupure proposée à une pause, en fin de phrase de préfér
long_texte = "Tamin'ny taona roa arivo dia nanomboka ny dia. Nandeha tany Antsirabe izahay, ary nijanona herinandro tany."
mots3, fin3 = dire([long_texte.split(". ")[0] + ".", long_texte.split(". ")[1]], debit=0.45, pause=0.6)
r3 = aligner([{"scene_id": "long", "texte": long_texte}], mots3, fin3)
sc = r3[0]["scission"]
assert r3[0]["duree"] > 5 and sc, "proposition de scission"
assert sc[0]["textes"][0].endswith("dia.") and len(sc[0]["textes"]) == 2, sc
print("scission :", sc)

# 4. Cas réel 9974481b : 75 plans estimés à 353 s, voix réelle de 221 s → plus aucun plan « sans voix »
phrases = [f"Fehezanteny faha {i} misy teny vitsivitsy" for i in range(75)]
mots4, fin4 = dire(phrases, debit=0.44, pause=0.31)
assert abs(fin4 - 221.1) < 1, fin4
r4 = aligner([{"scene_id": f"s{i}", "texte": t} for i, t in enumerate(phrases)], mots4, fin4)
assert sum(1 for p in r4 if p["statut"] in ("hors_voix", "non_trouve")) == 0
assert abs(sum(p["duree"] for p in r4) - fin4) < 1e-3 and max(p["duree"] for p in r4) <= 5
print(f"75 plans calés sur {fin4:.1f} s de voix, aucun plan sans voix")

# 5. Répliques de la transcription : fins de phrases, pauses, 5 s au plus
mots5, _ = dire(["Manao ahoana ianareo?", "Faly be aho anio satria tonga eto daholo ianareo rehetra ary hiara hiresaka momba ny tantaran'ny reniko isika"], debit=0.4, pause=0.7)
g = repliques(mots5)
assert g[0]["texte"] == "Manao ahoana ianareo?"
assert all(x["fin"] - x["debut"] <= 5 for x in g) and len(g) >= 3, [(x["debut"], x["fin"]) for x in g]

# 6. Ton déduit des indices
base = {"debit": 2.4, "pause_avant": 0.2, "volume": 0.0, "pente": 0.0, "variation": 0.1}
assert ton("Manao ahoana?", base) == "interrogatif"
assert ton("Eny", dict(base, pente=12)) == "interrogatif"
assert ton("Haha", dict(base, variation=0.35, volume=3)) == "rieur"
assert ton("Faly be", dict(base, debit=3.1, volume=1.5)) == "joyeux"
assert ton("Malahelo", dict(base, debit=1.6, pause_avant=0.9)) == "ému"
assert ton("Tsara", base) == "calme"

# 7. Transcription complète sur un son synthétique (sans librosa : hauteur neutre)
sr = 16000
son = np.zeros(int(fin * sr), dtype=np.float32)
for m in mots:
    a, b = int(m["debut"] * sr), int(m["fin"] * sr)
    son[a:b] = 0.2 * np.sin(2 * np.pi * 180 * np.arange(b - a) / sr)
t = transcrire(son, sr, mots)
assert len(t) == 4 and all(k in t[0] for k in ("debut", "fin", "texte", "ton", "indices", "description"))
print("transcription :", [(x["debut"], x["fin"], x["ton"], x["description"]) for x in t])
print("OK")
