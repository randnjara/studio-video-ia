"""Serveur RunPod du studio : transforme une photo en clip vidéo avec Wan 2.2 (image → vidéo).

Le modèle est chargé une seule fois au démarrage du serveur, puis chaque demande :
1. télécharge la photo (lien temporaire envoyé par le site) ;
2. la recadre au format du projet et génère le clip en 4 étapes (LoRA « Lightning » de lightx2v) ;
3. dépose le MP4 directement dans le stockage Supabase grâce au lien d'envoi fourni par le site.
"""

import os
import tempfile
import time
import traceback
from io import BytesIO

# Les poids du modèle (≈ 70 Go) sont gardés sur le volume réseau s'il existe, pour ne les télécharger qu'une fois
if os.path.isdir("/runpod-volume"):
    os.environ.setdefault("HF_HOME", "/runpod-volume/huggingface")

import requests
import runpod
import torch
from diffusers import WanImageToVideoPipeline
from diffusers.utils import export_to_video
from huggingface_hub import list_repo_files
from PIL import Image, ImageOps

MODELE = os.environ.get("WAN_MODEL", "Wan-AI/Wan2.2-I2V-A14B-Diffusers")
LORA_REPO = os.environ.get("LORA_REPO", "lightx2v/Wan2.2-Distill-Loras")
ETAPES = int(os.environ.get("STEPS", "4"))
IMAGES_PAR_SECONDE = 16

# Largeur × hauteur du clip selon la qualité et le format du projet (tailles habituelles du modèle)
TAILLES = {
    "480p": {"16:9": (832, 480), "9:16": (480, 832), "1:1": (624, 624)},
    "720p": {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (960, 960)},
}


def fichier_lora(fichiers, bruit):
    """Choisit le LoRA 4 étapes image → vidéo pour l'expert « high » ou « low » (ou celui imposé par LORA_HIGH / LORA_LOW)."""
    impose = os.environ.get(f"LORA_{bruit.upper()}")
    if impose:
        return impose
    candidats = sorted(
        f
        for f in fichiers
        if f.endswith(".safetensors")
        and "i2v" in f.lower()
        and f"{bruit}_noise" in f.lower()
        and "4step" in f.lower()
    )
    if not candidats:
        raise RuntimeError(f"Aucun LoRA 4 étapes « {bruit} noise » trouvé dans {LORA_REPO}")
    return candidats[-1]


def charger():
    debut = time.time()
    pipe = WanImageToVideoPipeline.from_pretrained(MODELE, torch_dtype=torch.bfloat16)
    fichiers = list_repo_files(LORA_REPO)
    haut, bas = fichier_lora(fichiers, "high"), fichier_lora(fichiers, "low")
    print(f"LoRA : {haut} / {bas}")
    pipe.load_lora_weights(LORA_REPO, weight_name=haut, adapter_name="rapide")
    pipe.load_lora_weights(LORA_REPO, weight_name=bas, adapter_name="rapide_2", load_into_transformer_2=True)
    pipe.to("cuda")
    print(f"Modèle prêt en {time.time() - debut:.0f} s")
    return pipe


def nombre_images(duree):
    """Le modèle veut 4k + 1 images : 5 s à 16 images/s donnent 81 images."""
    duree = min(max(float(duree or 5), 1.0), 10.0)
    return 4 * round(duree * IMAGES_PAR_SECONDE / 4) + 1


def generer(pipe, entree):
    for champ in ("image_url", "prompt", "upload_url", "video_path"):
        if not entree.get(champ):
            return {"error": f"Champ manquant : {champ}"}

    reponse = requests.get(entree["image_url"], timeout=60)
    reponse.raise_for_status()
    photo = ImageOps.exif_transpose(Image.open(BytesIO(reponse.content))).convert("RGB")

    tailles = TAILLES.get(entree.get("resolution"), TAILLES["480p"])
    largeur, hauteur = tailles.get(entree.get("format"), tailles["16:9"])
    photo = ImageOps.fit(photo, (largeur, hauteur), Image.LANCZOS)

    debut = time.time()
    images = pipe(
        image=photo,
        prompt=entree["prompt"],
        negative_prompt=entree.get("negative_prompt", ""),
        width=largeur,
        height=hauteur,
        num_frames=nombre_images(entree.get("duration", 5)),
        num_inference_steps=ETAPES,
        # La version rapide se passe du guidage classique : 1.0 sur les deux experts
        guidance_scale=1.0,
        guidance_scale_2=1.0,
        generator=torch.Generator("cuda").manual_seed(int(entree.get("seed", 0)) % 2**32),
    ).frames[0]
    secondes = time.time() - debut

    with tempfile.TemporaryDirectory() as dossier:
        chemin = os.path.join(dossier, "clip.mp4")
        export_to_video(images, chemin, fps=IMAGES_PAR_SECONDE, quality=8)
        with open(chemin, "rb") as f:
            envoi = requests.put(
                entree["upload_url"],
                data=f,
                headers={"Content-Type": "video/mp4", "x-upsert": "true"},
                timeout=300,
            )
    if not envoi.ok:
        return {"error": f"Envoi de la vidéo refusé ({envoi.status_code}) : {envoi.text[:200]}"}

    return {"video_path": entree["video_path"], "secondes": round(secondes, 1), "taille": f"{largeur}x{hauteur}"}


PIPE = None


def handler(job):
    global PIPE
    try:
        if PIPE is None:
            PIPE = charger()
        return generer(PIPE, job["input"])
    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__} : {e}"[:500]}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
