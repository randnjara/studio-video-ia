"""Contrôle de la carte graphique au démarrage du serveur : la carte est-elle gérée par le torch de l'image ?

Une carte Blackwell (RTX PRO 6000, B200, MIG 1g.24gb… : sm_100 / sm_120) demande un torch compilé avec CUDA 12.8 ou plus.
Sur une image trop ancienne, le premier calcul plante (« no kernel image is available for execution on the device ») et
RunPod marque la machine « unhealthy ». Ici, le serveur le voit tout de suite et répond à chaque travail par un message
clair (« carte X non compatible avec l'image »), visible dans l'historique du studio, sans planter.
(Même fichier dans worker/, worker-voix/ et worker-lipsync/.)
"""


def arch_compatible(cap, archs):
    """La carte de capacité cap = (majeur, mineur) peut-elle exécuter un des codes compilés « archs » (sm_80, compute_90…) ?
    Un code sm_XY tourne sur toute carte de même majeur X et de mineur ≥ Y ; un code compute_XY (PTX) sur toute carte ≥ XY."""
    majeur, mineur = cap
    for a in archs:
        genre, _, num = a.partition("_")
        if not num.isdigit() or len(num) < 2:
            continue
        m, n = int(num[:-1]), int(num[-1])
        if genre == "sm" and m == majeur and n <= mineur:
            return True
        if genre == "compute" and (m, n) <= (majeur, mineur):
            return True
    return False


def plage(archs):
    sms = sorted(int(a[3:]) for a in archs if a.startswith("sm_") and a[3:].isdigit())
    return f"sm_{sms[0]}…sm_{sms[-1]}" if sms else "aucune architecture"


def verifier_carte():
    """Renvoie (True, description) si la carte est utilisable, sinon (False, message clair pour le studio).
    Sans carte graphique (construction de l'image, test), renvoie (True, "pas de carte graphique")."""
    try:
        import torch
    except ImportError:
        return True, "torch absent"
    if not torch.cuda.is_available():
        return True, "pas de carte graphique"
    nom = torch.cuda.get_device_name(0)
    cap = torch.cuda.get_device_capability(0)
    archs = torch.cuda.get_arch_list()
    description = f"{nom} (sm_{cap[0]}{cap[1]}), torch {torch.__version__} CUDA {torch.version.cuda}"
    if not arch_compatible(cap, archs):
        return False, (
            f"Carte {nom} (sm_{cap[0]}{cap[1]}) non compatible avec l'image : torch {torch.__version__} "
            f"(CUDA {torch.version.cuda}) gère {plage(archs)}. Limitez le serveur à des cartes compatibles "
            "ou passez à une image CUDA 12.8 ou plus."
        )
    try:
        # Un vrai petit calcul : certaines cartes passent le contrôle mais n'ont pas de code compilé pour elles
        (torch.ones(8, device="cuda") * 2).sum().item()
    except RuntimeError as e:
        return False, f"Carte {nom} (sm_{cap[0]}{cap[1]}) non compatible avec l'image : {str(e).splitlines()[0][:200]}"
    return True, description
