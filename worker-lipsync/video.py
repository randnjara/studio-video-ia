"""Outils sans carte graphique du serveur lip-sync : nombre d'images, écriture du MP4 muet, dernière image.

Le modèle travaille à 25 images/s. La vidéo rendue au studio a exactement autant d'images que la voix en demande
(durée × 25, arrondi) : au montage, la bouche tombe juste sur la voix posée sur sa propre piste.
"""

import subprocess

IMAGES_PAR_SECONDE = 25
# InfiniteTalk travaille par fenêtres de 81 images et refuse une voix plus courte que cela : on la complète par du silence,
# puis la vidéo est recoupée à la vraie durée
FENETRE = 81


def nombre_images(duree_s):
    """Images de la vidéo pour une voix de cette durée (au moins 1)."""
    return max(1, round(float(duree_s) * IMAGES_PAR_SECONDE))


def echantillons_minimum(frequence=16000):
    """Longueur minimale de la voix donnée au modèle (un peu plus d'une fenêtre)."""
    return int((FENETRE + 4) / IMAGES_PAR_SECONDE * frequence)


def ecrire_mp4_muet(images, nombre, largeur, hauteur, chemin, qualite=18):
    """Écrit exactement « nombre » images (tableaux uint8 H×W×3) en MP4 H.264 SANS piste audio (-an), à 25 images/s.
    S'il manque des images, la dernière est répétée ; celles en trop sont ignorées. Renvoie la dernière image écrite."""
    process = subprocess.Popen(
        [
            "ffmpeg", "-v", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{largeur}x{hauteur}", "-r", str(IMAGES_PAR_SECONDE), "-i", "-",
            "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(qualite), "-preset", "medium",
            "-r", str(IMAGES_PAR_SECONDE), "-movflags", "+faststart", chemin,
        ],
        stdin=subprocess.PIPE,
    )
    ecrites = 0
    derniere = None
    try:
        for image in images:
            if ecrites >= nombre:
                break
            process.stdin.write(image.tobytes())
            derniere = image
            ecrites += 1
        if derniere is None:
            raise ValueError("Aucune image générée.")
        while ecrites < nombre:
            process.stdin.write(derniere.tobytes())
            ecrites += 1
    finally:
        process.stdin.close()
        if process.wait() != 0:
            raise RuntimeError("ffmpeg n'a pas pu écrire la vidéo.")
    return derniere
