"""Finitions d'un clip, juste après Wan (image → vidéo ou VACE), sur la même carte graphique, avec des outils libres :

- couleurs stables : chaque image garde les couleurs de la première (moyenne et contraste en Lab, à moitié), pour que
  le clip ne jaunisse ni ne sature au fil des secondes ; la première image ne bouge pas, le raccord reste invisible,
  et la dernière image (photo de départ du clip suivant) part corrigée : la dérive ne s'additionne plus ;
- fluidité : RIFE 4.7 (Practical-RIFE) calcule une image entre chaque paire, 16 → 32 images par seconde ;
- netteté : Real-ESRGAN (realesr-general-x4v3, fait pour la vidéo), ramené au double de la taille d'origine.

Chaque étape est facultative, et une étape ratée est sautée : le clip est toujours rendu.
"""

import os

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

# Poids copiés dans l'image Docker (voir Dockerfile)
POIDS_NETTETE = os.environ.get("ESRGAN_WEIGHTS", "/app/modeles/realesr-general-x4v3.pth")
POIDS_RIFE = os.environ.get("RIFE_WEIGHTS", "/app/modeles/rife47.pth")
EN_MEMOIRE = {"nettete": None, "rife": None}
# Part de Real-ESRGAN dans l'image finale, le reste en simple agrandissement : à 100 %, la peau devient lisse comme
# de la cire et les rides disparaissent (essai sur MAMAN 2) ; le mélange garde la texture de la peau
PART_NETTETE = float(os.environ.get("ESRGAN_MIX", "0.6"))
APPAREIL = "cuda" if torch.cuda.is_available() else "cpu"

_RGB_XYZ = torch.tensor([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
_XYZ_RGB = torch.tensor([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
_BLANC = torch.tensor([0.95047, 1.0, 1.08883])


def en_tenseur(images):
    """Images de diffusers (PIL, ou tableaux de 0 à 1 ou de 0 à 255) → tenseur (n, 3, h, w) de 0 à 1 sur la carte."""
    tableau = np.stack([np.asarray(i.convert("RGB") if hasattr(i, "convert") else i) for i in images]).astype(np.float32)
    if tableau.max() > 1.0:
        tableau /= 255.0
    return torch.from_numpy(tableau).permute(0, 3, 1, 2).to(APPAREIL)


def en_images(tenseur):
    """Tenseur (n, 3, h, w) de 0 à 1 → images PIL (l'écriture du MP4 de diffusers multiplie les tableaux par 255)."""
    tableau = (tenseur.clamp(0, 1).permute(0, 2, 3, 1).float().cpu().numpy() * 255).round().astype(np.uint8)
    return [Image.fromarray(t) for t in tableau]


def _vers_lab(rgb):
    lineaire = torch.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = torch.einsum("nchw,dc->ndhw", lineaire, _RGB_XYZ.to(rgb)) / _BLANC.to(rgb).view(1, 3, 1, 1)
    f = torch.where(xyz > 0.008856, xyz.clamp(min=1e-6) ** (1 / 3), 7.787 * xyz + 16 / 116)
    return torch.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def _depuis_lab(lab):
    fy = (lab[:, 0] + 16) / 116
    f = torch.stack([fy + lab[:, 1] / 500, fy, fy - lab[:, 2] / 200], 1)
    xyz = torch.where(f > 0.206893, f**3, (f - 16 / 116) / 7.787) * _BLANC.to(lab).view(1, 3, 1, 1)
    lineaire = torch.einsum("nchw,dc->ndhw", xyz, _XYZ_RGB.to(lab)).clamp(0, 1)
    return torch.where(lineaire <= 0.0031308, 12.92 * lineaire, 1.055 * lineaire.clamp(min=1e-6) ** (1 / 2.4) - 0.055).clamp(0, 1)


def couleurs_stables(images, force=0.5):
    """Rapproche la moyenne et le contraste de chaque image (en Lab) de ceux de la première image."""
    lab = _vers_lab(images)
    moy, ecart = lab.mean((2, 3), keepdim=True), lab.std((2, 3), keepdim=True) + 1e-4
    corrige = (lab - moy) * (ecart[:1] / ecart) + moy[:1]
    sortie = _depuis_lab(lab + force * (corrige - lab))
    sortie[0] = images[0]
    return sortie


def fluidifier(images, par_lot=8):
    """Une image RIFE entre chaque paire : n images → 2n - 1."""
    if EN_MEMOIRE["rife"] is None:
        from rife_arch import IFNet

        modele = IFNet(arch_ver="4.7")
        modele.load_state_dict(torch.load(POIDS_RIFE, map_location="cpu", weights_only=False))
        EN_MEMOIRE["rife"] = modele.eval().to(APPAREIL)
    modele = EN_MEMOIRE["rife"]
    milieux = []
    with torch.inference_mode():
        for i in range(0, len(images) - 1, par_lot):
            a, b = images[i : min(i + par_lot, len(images) - 1)], images[i + 1 : min(i + par_lot, len(images) - 1) + 1]
            temps = torch.full((len(a), 1, 1, 1), 0.5, device=APPAREIL)
            milieux.append(modele(a, b, temps, [8, 4, 2, 1], True, False).clamp(0, 1))
    milieux = torch.cat(milieux)
    sortie = torch.empty((len(images) * 2 - 1, *images.shape[1:]), device=APPAREIL, dtype=images.dtype)
    sortie[0::2], sortie[1::2] = images, milieux.to(images.dtype)
    return sortie


def plus_net(images, facteur=2, par_lot=8):
    """Real-ESRGAN ×4 puis réduction : la vidéo sort au double (par défaut) de sa taille, plus nette."""
    if EN_MEMOIRE["nettete"] is None:
        from spandrel import ModelLoader

        modele = ModelLoader().load_from_file(POIDS_NETTETE).eval()
        EN_MEMOIRE["nettete"] = modele.to(APPAREIL)
    modele = EN_MEMOIRE["nettete"]
    h, w = images.shape[2] * facteur, images.shape[3] * facteur
    sortie = []
    with torch.inference_mode():
        for i in range(0, len(images), par_lot):
            lot = images[i : i + par_lot]
            net = F.interpolate(modele(lot).clamp(0, 1), size=(h, w), mode="bicubic", antialias=True)
            simple = F.interpolate(lot, size=(h, w), mode="bicubic")
            sortie.append((PART_NETTETE * net + (1 - PART_NETTETE) * simple).clamp(0, 1).cpu())
    return torch.cat(sortie)


def finitions(images, reglages):
    """Renvoie (images du clip fini, dernière image en taille d'origine). Réglages : couleurs (force de 0 à 1),
    fluidite (booléen), nettete (facteur, 0 pour ne rien faire). Une étape ratée est sautée."""
    tenseur = en_tenseur(images)
    if float(reglages.get("couleurs") or 0) > 0:
        try:
            tenseur = couleurs_stables(tenseur, float(reglages["couleurs"]))
        except Exception as e:
            print(f"Couleurs non corrigées : {e}")
    derniere = en_images(tenseur[-1:])[0]
    if reglages.get("fluidite"):
        try:
            tenseur = fluidifier(tenseur)
        except Exception as e:
            print(f"Images intermédiaires non calculées : {e}")
    if int(reglages.get("nettete") or 0) > 1:
        try:
            tenseur = plus_net(tenseur, int(reglages["nettete"]))
        except Exception as e:
            print(f"Netteté non améliorée : {e}")
    return en_images(tenseur), derniere
