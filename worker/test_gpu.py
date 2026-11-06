# Contrôle de la carte graphique au démarrage (gpu.py, même fichier dans les trois workers).
# Lancer : python3 worker/test_gpu.py (sans carte graphique ni torch)
import os
import sys

for dossier in ("worker", "worker-voix", "worker-lipsync"):
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), dossier))
    sys.modules.pop("gpu", None)
    import gpu  # noqa: E402

    ancien = ["sm_50", "sm_60", "sm_70", "sm_75", "sm_80", "sm_86", "sm_90"]  # torch 2.6 cu124 (image voix v4/v5)
    cu128 = ["sm_75", "sm_80", "sm_86", "sm_90", "sm_100", "sm_120", "compute_120"]  # torch 2.7.1 cu128
    # La panne de prod : RTX PRO 6000 Blackwell MIG 1g.24gb (sm_120) sur l'ancienne image
    assert not gpu.arch_compatible((12, 0), ancien)
    assert gpu.plage(ancien) == "sm_50…sm_90"
    # Nouvelle image : Blackwell et toutes les cartes d'avant (A100 sm_80, A40/3090 sm_86, L4/4090 sm_89, H100 sm_90)
    for cap in [(12, 0), (10, 0), (8, 0), (8, 6), (8, 9), (9, 0)]:
        assert gpu.arch_compatible(cap, cu128), cap
    assert gpu.arch_compatible((8, 9), ["sm_86"]), "sm_89 exécute le code sm_86"
    assert not gpu.arch_compatible((8, 0), ["sm_86"]), "sm_80 n'exécute pas le code sm_86"
    assert gpu.arch_compatible((12, 1), ["compute_120"]), "PTX compute_120 sur sm_121"
    ok, msg = gpu.verifier_carte()
    assert ok, msg
    print(dossier, "OK")
