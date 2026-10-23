"""Serveur RunPod du studio, deux métiers (un serveur RunPod par métier, chacun avec son modèle en cache) :

- « video » (par défaut) : transforme une photo en clip avec Wan 2.2 (image → vidéo), en 4 étapes ;
- « image » : crée une photo de départ avec Qwen-Image-Edit-2511 à partir de 1 à 3 images de référence
  (personnages, lieux), en 4 étapes, pour garder les mêmes visages et tenues d'un plan à l'autre.

Un seul modèle tient en mémoire à la fois : il est chargé à la première demande de son métier, et remplacé
si l'autre métier est demandé. Le résultat (MP4 ou JPEG) est déposé directement dans le stockage Supabase
grâce au lien d'envoi fourni par le site.
"""

import gc
import math
import os
import shutil
import tempfile
import time
import traceback
from io import BytesIO

# Cache gratuit de RunPod (« Model » réglé sur le serveur) : le modèle est déjà sur la machine, en lecture seule
CACHE_RUNPOD = "/runpod-volume/huggingface-cache/hub"
# Sinon, ancien fonctionnement : les poids sont gardés sur le volume réseau s'il existe (payant au mois)
_DOSSIER_VOLUME = os.environ.get("VOLUME_DIR", "/runpod-volume")
VOLUME = _DOSSIER_VOLUME if os.path.isdir(_DOSSIER_VOLUME) and not os.path.isdir(CACHE_RUNPOD) else None
if VOLUME:
    os.environ.setdefault("HF_HOME", f"{VOLUME}/huggingface")

import requests
import runpod
import torch
from diffusers import FlowMatchEulerDiscreteScheduler, QwenImageEditPlusPipeline, WanImageToVideoPipeline
from diffusers.utils import export_to_video
from huggingface_hub import hf_hub_download, list_repo_files
from PIL import Image, ImageOps

MODELE = os.environ.get("WAN_MODEL", "Wan-AI/Wan2.2-I2V-A14B-Diffusers")
LORA_REPO = os.environ.get("LORA_REPO", "lightx2v/Wan2.2-Distill-Loras")
ETAPES = int(os.environ.get("STEPS", "4"))
IMAGES_PAR_SECONDE = 16

# Wan 2.2 est publié en 32 bits (126 Go). Sur le volume, on garde une copie en 16 bits (≈ 70 Go) :
# deux fois moins de place, et un démarrage plus rapide.
WAN_LOCAL = f"{VOLUME}/modeles/wan22-i2v-bf16" if VOLUME else None

QWEN_MODELE = os.environ.get("QWEN_MODEL", "Qwen/Qwen-Image-Edit-2511")
QWEN_LORA_REPO = os.environ.get("QWEN_LORA_REPO", "lightx2v/Qwen-Image-Edit-2511-Lightning")
QWEN_LORA = os.environ.get("QWEN_LORA", "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors")
QWEN_ETAPES = int(os.environ.get("QWEN_STEPS", "4"))
# Tailles conseillées pour Qwen-Image ; Wan recadre ensuite la photo au format du clip
TAILLES_PHOTO = {"16:9": (1664, 928), "9:16": (928, 1664), "1:1": (1328, 1328)}
# Réglage du planificateur utilisé pour la version rapide (Qwen-Image-Lightning, shift = 3)
PLANIFICATEUR_RAPIDE = {
    "base_image_seq_len": 256,
    "base_shift": math.log(3),
    "invert_sigmas": False,
    "max_image_seq_len": 8192,
    "max_shift": math.log(3),
    "num_train_timesteps": 1000,
    "shift": 1.0,
    "shift_terminal": None,
    "stochastic_sampling": False,
    "time_shift_type": "exponential",
    "use_beta_sigmas": False,
    "use_dynamic_shifting": True,
    "use_exponential_sigmas": False,
    "use_karras_sigmas": False,
}

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


def dans_cache(depot):
    """Dossier du modèle dans le cache RunPod, ou None s'il n'y est pas."""
    racine = os.path.join(CACHE_RUNPOD, "models--" + depot.replace("/", "--"))
    instantanes = os.path.join(racine, "snapshots")
    ref = os.path.join(racine, "refs", "main")
    if os.path.isfile(ref):
        with open(ref) as f:
            dossier = os.path.join(instantanes, f.read().strip())
        if os.path.isdir(dossier):
            return dossier
    if os.path.isdir(instantanes):
        versions = sorted(os.listdir(instantanes))
        if versions:
            return os.path.join(instantanes, versions[0])
    return None


def charger_wan():
    debut = time.time()
    cache = dans_cache(MODELE)
    if cache:
        print(f"Wan 2.2 lu dans le cache RunPod : {cache}")
        pipe = WanImageToVideoPipeline.from_pretrained(cache, torch_dtype=torch.bfloat16)
    elif WAN_LOCAL and os.path.isfile(f"{WAN_LOCAL}/model_index.json"):
        pipe = WanImageToVideoPipeline.from_pretrained(WAN_LOCAL, torch_dtype=torch.bfloat16)
    else:
        # Premier démarrage : téléchargement sur le disque de la machine, puis copie allégée sur le volume
        cache = "/tmp/wan-telechargement" if WAN_LOCAL else None
        pipe = WanImageToVideoPipeline.from_pretrained(MODELE, torch_dtype=torch.bfloat16, cache_dir=cache)
        if WAN_LOCAL:
            provisoire = f"{WAN_LOCAL}.partiel"
            shutil.rmtree(provisoire, ignore_errors=True)
            pipe.save_pretrained(provisoire)
            shutil.rmtree(WAN_LOCAL, ignore_errors=True)
            os.rename(provisoire, WAN_LOCAL)
            shutil.rmtree(cache, ignore_errors=True)
            print(f"Copie 16 bits de Wan 2.2 gardée sur le volume en {time.time() - debut:.0f} s")
    fichiers = list_repo_files(LORA_REPO)
    haut, bas = fichier_lora(fichiers, "high"), fichier_lora(fichiers, "low")
    print(f"LoRA : {haut} / {bas}")
    pipe.load_lora_weights(LORA_REPO, weight_name=haut, adapter_name="rapide")
    pipe.load_lora_weights(LORA_REPO, weight_name=bas, adapter_name="rapide_2", load_into_transformer_2=True)
    pipe.to("cuda")
    print(f"Wan 2.2 prêt en {time.time() - debut:.0f} s")
    return pipe


def charger_qwen():
    debut = time.time()
    planificateur = FlowMatchEulerDiscreteScheduler.from_config(PLANIFICATEUR_RAPIDE)
    source = dans_cache(QWEN_MODELE) or QWEN_MODELE
    print(f"Qwen-Image-Edit lu depuis {source}")
    pipe = QwenImageEditPlusPipeline.from_pretrained(source, scheduler=planificateur, torch_dtype=torch.bfloat16)
    pipe.load_lora_weights(hf_hub_download(QWEN_LORA_REPO, QWEN_LORA))
    pipe.to("cuda")
    print(f"Qwen-Image-Edit prêt en {time.time() - debut:.0f} s (LoRA {QWEN_LORA})")
    return pipe


def telecharger_image(url):
    reponse = requests.get(url, timeout=60)
    reponse.raise_for_status()
    return ImageOps.exif_transpose(Image.open(BytesIO(reponse.content))).convert("RGB")


def nombre_images(duree):
    """Le modèle veut 4k + 1 images : 5 s à 16 images/s donnent 81 images."""
    duree = min(max(float(duree or 5), 1.0), 10.0)
    return 4 * round(duree * IMAGES_PAR_SECONDE / 4) + 1


def generer_video(pipe, entree):
    for champ in ("image_url", "prompt", "upload_url", "video_path"):
        if not entree.get(champ):
            return {"error": f"Champ manquant : {champ}"}

    photo = telecharger_image(entree["image_url"])

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


def generer_image(pipe, entree):
    for champ in ("prompt", "upload_url", "image_path"):
        if not entree.get(champ):
            return {"error": f"Champ manquant : {champ}"}
    references = [telecharger_image(u) for u in (entree.get("reference_urls") or [])[:3]]
    if not references:
        return {"error": "Aucune image de référence : ajoutez un personnage ou un lieu cité dans la description."}

    largeur, hauteur = TAILLES_PHOTO.get(entree.get("format"), TAILLES_PHOTO["16:9"])
    debut = time.time()
    photo = pipe(
        image=references,
        prompt=entree["prompt"],
        negative_prompt=entree.get("negative_prompt") or " ",
        width=largeur,
        height=hauteur,
        num_inference_steps=QWEN_ETAPES,
        true_cfg_scale=1.0,
        generator=torch.Generator("cuda").manual_seed(int(entree.get("seed", 0)) % 2**32),
    ).images[0]
    secondes = time.time() - debut

    tampon = BytesIO()
    photo.save(tampon, format="JPEG", quality=92)
    envoi = requests.put(
        entree["upload_url"],
        data=tampon.getvalue(),
        headers={"Content-Type": "image/jpeg", "x-upsert": "true"},
        timeout=120,
    )
    if not envoi.ok:
        return {"error": f"Envoi de la photo refusé ({envoi.status_code}) : {envoi.text[:200]}"}
    return {"image_path": entree["image_path"], "secondes": round(secondes, 1), "taille": f"{largeur}x{hauteur}"}


METIERS = {"video": (charger_wan, generer_video), "image": (charger_qwen, generer_image)}
EN_MEMOIRE = {"metier": None, "pipe": None}


def handler(job):
    try:
        entree = job["input"]
        metier = entree.get("mode", "video")
        if metier not in METIERS:
            return {"error": f"Métier inconnu : {metier}"}
        charger, generer = METIERS[metier]
        if EN_MEMOIRE["metier"] != metier:
            # Un seul modèle tient sur la carte : on libère l'autre avant de charger celui-ci
            EN_MEMOIRE["pipe"], EN_MEMOIRE["metier"] = None, None
            gc.collect()
            torch.cuda.empty_cache()
            EN_MEMOIRE["pipe"], EN_MEMOIRE["metier"] = charger(), metier
        return generer(EN_MEMOIRE["pipe"], entree)
    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__} : {e}"[:500]}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
