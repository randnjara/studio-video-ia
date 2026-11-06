# Nouvelles envoyées au studio (progress_update) : format, bornes, une nouvelle au plus toutes les 2 s par étape.
# Lancer : python3 worker/test_progression.py (le même fichier progression.py est dans les trois workers)
import os
import sys
import types

envoyees = []
faux = types.ModuleType("runpod")
faux.serverless = types.SimpleNamespace(progress_update=lambda job, p: envoyees.append((job["id"], p)))
sys.modules["runpod"] = faux
for dossier in ("worker", "worker-voix", "worker-lipsync"):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), dossier))
    sys.modules.pop("progression", None)
    import progression  # noqa: E402

    envoyees.clear()
    assert progression.signaler("calcul", 10) is False, "sans travail : rien"
    progression.commencer({"id": "j1"})
    assert progression.signaler("demarrage", None, "chargement", forcer=True)
    assert progression.signaler("calcul", 12.345, "étape 1/4")
    assert not progression.signaler("calcul", 20, "étape 2/4"), "même étape moins de 2 s après : ignorée"
    assert progression.signaler("calcul", 140, "fin", forcer=True)
    assert progression.signaler("envoi", None, "dépôt")
    etapes = [p["etape"] for _, p in envoyees]
    assert etapes == ["demarrage", "calcul", "calcul", "envoi"], etapes
    assert envoyees[1][1] == {"etape": "calcul", "pct": 12.3, "message": "étape 1/4"}
    assert envoyees[2][1]["pct"] == 100.0, "borné à 100 %"
    # Une erreur d'envoi ne casse jamais le travail
    faux.serverless.progress_update = lambda job, p: (_ for _ in ()).throw(RuntimeError("réseau"))
    assert progression.signaler("calcul", 50, forcer=True) is False
    faux.serverless.progress_update = lambda job, p: envoyees.append((job["id"], p))
    print(dossier, "OK")
