"""Serveur RunPod lip-sync du studio : InfiniteTalk (MeiGen-AI) sur Wan 2.1 image → vidéo 14B (480p ou 720p).

Entrée (mode « lipsync ») :
- image_url : photo de départ du plan (ou dernière image du clip précédent) ;
- audio_url : morceau de voix off du plan (WAV 16 kHz mono, découpé par le serveur voix) ;
- prompt : gestes, regard, caméra (la parole vient de la voix) ; resolution : 480p ou 720p ; seed ;
- video_path / upload_url : où déposer le MP4 ; last_frame_path / last_frame_upload_url : où déposer la dernière image.

Sortie : un MP4 SANS piste audio, à 25 images/s, avec exactement round(durée de la voix × 25) images, et sa dernière
image en JPEG. Au montage, la voix off d'origine est posée sur sa propre piste, calée sur le clip.

Le modèle est chargé une fois au démarrage de la machine et gardé en mémoire (carte de 80 Go).
"""

import os
import sys
import tempfile
import time
import traceback
from io import BytesIO
from types import SimpleNamespace

sys.path.insert(0, os.environ.get("INFINITETALK_DIR", "/app/InfiniteTalk"))

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import pyloudnorm as pyln  # noqa: E402
import requests  # noqa: E402
import runpod  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402
from einops import rearrange  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

from gpu import verifier_carte  # noqa: E402
from progression import commencer, signaler  # noqa: E402

# Carte graphique gérée par le torch de l'image ? Sinon chaque travail répond par un message clair, sans planter
CARTE_OK, CARTE = verifier_carte()
print(f"Carte graphique : {CARTE}")


def carte_refusee(job):
    if CARTE_OK:
        return None
    commencer(job)
    signaler("demarrage", None, CARTE, forcer=True)
    return {"error": CARTE}
from video import FENETRE, echantillons_minimum, ecrire_mp4_muet, nombre_images  # noqa: E402

# Suivi du calcul : InfiniteTalk avance par fenêtres de 81 images, chacune en ETAPES étapes (barre tqdm) ; chaque étape
# faite est comptée pour donner au studio « images ~60/125 »
SUIVI = {"fait": 0, "total": 1, "images": 0}


def suivi_tqdm(iterable=None, *args, **kwargs):
    for x in iterable if iterable is not None else []:
        yield x
        SUIVI["fait"] += 1
        part = min(1.0, SUIVI["fait"] / max(1, SUIVI["total"]))
        signaler("calcul", part * 100, f"images ~{round(part * SUIVI['images'])}/{SUIVI['images']} · étape {SUIVI['fait']}/{SUIVI['total']}")

CACHE_RUNPOD = "/runpod-volume/huggingface-cache/hub"
WAN = os.environ.get("WAN_MODEL", "Wan-AI/Wan2.1-I2V-14B-480P")
INFINITETALK_REPO = os.environ.get("INFINITETALK_REPO", "MeiGen-AI/InfiniteTalk")
INFINITETALK_FICHIER = os.environ.get("INFINITETALK_FILE", "single/infinitetalk.safetensors")
WAV2VEC = os.environ.get("WAV2VEC_DIR", "/app/poids/chinese-wav2vec2-base")
# Version rapide : LoRA lightx2v (peu d'étapes, guidage réduit). LORA_REPO="" revient à la version normale (40 étapes).
LORA_REPO = os.environ.get("LORA_REPO", "Kijai/WanVideo_comfy")
LORA_FICHIER = os.environ.get("LORA_FILE", "Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors")
LORA_FORCE = float(os.environ.get("LORA_SCALE", "1.0"))
RAPIDE = bool(LORA_REPO)
ETAPES = int(os.environ.get("STEPS", "6" if RAPIDE else "40"))
DECALAGE = float(os.environ.get("SHIFT", "2" if RAPIDE else "7"))
GUIDAGE_TEXTE = float(os.environ.get("TEXT_GUIDE", "1.0" if RAPIDE else "5.0"))
# Guidage par la voix : plus haut = bouche plus fidèle (3 à 5 conseillé sans LoRA, 2 avec)
GUIDAGE_VOIX = float(os.environ.get("AUDIO_GUIDE", "2.0" if RAPIDE else "4.0"))
IMAGES_MOUVEMENT = int(os.environ.get("MOTION_FRAME", "9"))
COULEURS = float(os.environ.get("COLOR_CORRECTION", "1.0"))

ETAT = {"pipe": None, "encodeur": None, "extracteur": None}


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


def charger():
    """Charge Wan 2.1 + InfiniteTalk (+ LoRA rapide) et l'encodeur de voix, une fois par machine."""
    if ETAT["pipe"] is not None:
        return
    import wan
    from transformers import Wav2Vec2FeatureExtractor
    from src.audio_analysis.wav2vec2 import Wav2Vec2Model
    from wan.configs import WAN_CONFIGS

    debut = time.time()
    wan_dir = dans_cache(WAN)
    signaler("demarrage" if wan_dir else "telechargement", None, "chargement de Wan 2.1 et InfiniteTalk" if wan_dir else "téléchargement de Wan 2.1 (réglez « Model » sur le serveur)", forcer=True)
    if not wan_dir:
        from huggingface_hub import snapshot_download

        print(f"{WAN} absent du cache RunPod : téléchargement (réglez le champ « Model » du serveur pour l'éviter)")
        wan_dir = snapshot_download(WAN)
    infinitetalk = hf_hub_download(INFINITETALK_REPO, INFINITETALK_FICHIER)
    lora = [hf_hub_download(LORA_REPO, LORA_FICHIER)] if RAPIDE else None
    print(f"Wan 2.1 : {wan_dir} · InfiniteTalk : {infinitetalk} · LoRA : {lora}")
    ETAT["pipe"] = wan.InfiniteTalkPipeline(
        config=WAN_CONFIGS["infinitetalk-14B"],
        checkpoint_dir=wan_dir,
        device_id=0,
        rank=0,
        t5_fsdp=False,
        dit_fsdp=False,
        use_usp=False,
        t5_cpu=False,
        lora_dir=lora,
        lora_scales=[LORA_FORCE] if lora else None,
        infinitetalk_dir=infinitetalk,
    )
    encodeur = Wav2Vec2Model.from_pretrained(WAV2VEC, local_files_only=True).to("cpu")
    encodeur.feature_extractor._freeze_parameters()
    ETAT["encodeur"] = encodeur
    ETAT["extracteur"] = Wav2Vec2FeatureExtractor.from_pretrained(WAV2VEC, local_files_only=True)
    # Les étapes de diffusion d'InfiniteTalk passent par tqdm : on les compte pour le studio
    import wan.multitalk as multitalk

    attention_sans_flash_attn()

    multitalk.tqdm = suivi_tqdm
    print(f"InfiniteTalk prêt en {time.time() - debut:.0f} s ({ETAPES} étapes, voix {GUIDAGE_VOIX}, texte {GUIDAGE_TEXTE})")


def attention_sans_flash_attn():
    """flash-attn sans code pour cette carte (ex. Blackwell sm_120 avec une roue sans sm_120) : InfiniteTalk passe à
    l'attention de PyTorch (SDPA), un peu plus lente mais juste (un seul clip à la fois, sans remplissage)."""
    import torch

    try:
        import flash_attn

        q = torch.randn(1, 16, 2, 64, device="cuda", dtype=torch.bfloat16)
        flash_attn.flash_attn_func(q, q, q)
        print("flash-attn utilisable sur cette carte")
        return False
    except Exception as e:
        print(f"flash-attn inutilisable ici ({str(e).splitlines()[0][:160]}) : attention de PyTorch")
    import wan.modules.attention as attention
    import wan.modules.multitalk_model as modele

    attention.FLASH_ATTN_2_AVAILABLE = False
    attention.FLASH_ATTN_3_AVAILABLE = False

    def sdpa(q, k, v, q_lens=None, k_lens=None, **options):
        sortie = attention.attention(q, k, v, **{k2: v2 for k2, v2 in options.items() if k2 in ("dropout_p", "causal", "dtype")})
        return sortie.to(q.dtype)

    modele.flash_attention = sdpa
    return True


def telecharger(url, chemin):
    reponse = requests.get(url, timeout=120)
    reponse.raise_for_status()
    with open(chemin, "wb") as f:
        f.write(reponse.content)
    return chemin


def preparer_voix(chemin):
    """Voix à 16 kHz, volume normalisé (comme InfiniteTalk), complétée par du silence si elle est plus courte qu'une
    fenêtre du modèle. Renvoie (voix pour le modèle, durée réelle en secondes)."""
    voix, frequence = librosa.load(chemin, sr=16000, mono=True)
    duree = len(voix) / frequence
    mesure = pyln.Meter(frequence)
    volume = mesure.integrated_loudness(voix) if len(voix) > frequence * 0.4 else -100.0
    if abs(volume) <= 100:
        voix = pyln.normalize.loudness(voix, volume, -23)
    minimum = echantillons_minimum(frequence)
    if len(voix) < minimum:
        voix = np.concatenate([voix, np.zeros(minimum - len(voix), dtype=voix.dtype)])
    return voix.astype(np.float32), duree


def empreinte_voix(voix):
    """Empreinte de la voix image par image (wav2vec2), comme get_embedding d'InfiniteTalk."""
    images = len(voix) / 16000 * 25
    valeurs = np.squeeze(ETAT["extracteur"](voix, sampling_rate=16000).input_values)
    valeurs = torch.from_numpy(valeurs).float().unsqueeze(0)
    with torch.no_grad():
        sorties = ETAT["encodeur"](valeurs, seq_len=int(images), output_hidden_states=True)
    empreinte = torch.stack(sorties.hidden_states[1:], dim=1).squeeze(0)
    return rearrange(empreinte, "b s d -> s b d").cpu().detach()


def deposer(url, donnees, type_mime, delai=300):
    envoi = requests.put(url, data=donnees, headers={"Content-Type": type_mime, "x-upsert": "true"}, timeout=delai)
    if not envoi.ok:
        raise RuntimeError(f"Envoi refusé ({envoi.status_code}) : {envoi.text[:200]}")


def generer(entree):
    for champ in ("image_url", "audio_url", "upload_url", "video_path"):
        if not entree.get(champ):
            return {"error": f"Champ manquant : {champ}"}
    charger()
    resolution = "infinitetalk-720" if entree.get("resolution") == "720p" else "infinitetalk-480"
    seed = int(entree.get("seed", 0)) % 99_999_999
    debut = time.time()
    with tempfile.TemporaryDirectory() as dossier:
        image = os.path.join(dossier, "depart.jpg")
        photo = ImageOps.exif_transpose(Image.open(BytesIO(requests.get(entree["image_url"], timeout=60).content))).convert("RGB")
        photo.save(image, quality=95)
        voix, duree = preparer_voix(telecharger(entree["audio_url"], os.path.join(dossier, "voix.wav")))
        nombre = nombre_images(duree)
        fenetres = 1 + max(0, -(-(max(nombre, FENETRE) + 8 - FENETRE) // (FENETRE - IMAGES_MOUVEMENT)))
        SUIVI.update(fait=0, total=fenetres * ETAPES, images=nombre)
        signaler("calcul", 0, f"voix de {duree:.2f} s → {nombre} images", forcer=True)
        empreinte = os.path.join(dossier, "voix.pt")
        torch.save(empreinte_voix(voix), empreinte)
        options = SimpleNamespace(
            use_teacache=False, teacache_thresh=0.2, size=resolution, use_apg=False, apg_momentum=-0.75, apg_norm_threshold=55
        )
        video = ETAT["pipe"].generate_infinitetalk(
            {"prompt": entree.get("prompt") or "A person talking.", "cond_video": image, "cond_audio": {"person1": empreinte}},
            size_buckget=resolution,
            motion_frame=IMAGES_MOUVEMENT,
            frame_num=81,
            shift=DECALAGE,
            sampling_steps=ETAPES,
            text_guide_scale=GUIDAGE_TEXTE,
            audio_guide_scale=GUIDAGE_VOIX,
            n_prompt=entree.get("negative_prompt") or "",
            seed=seed,
            offload_model=False,
            max_frames_num=max(nombre, 81) + 8,
            color_correction_strength=COULEURS,
            extra_args=options,
        )
        # C × T × H × W dans [-1, 1] → images uint8, recoupées à la durée exacte de la voix
        images = ((video.float().clamp(-1, 1) + 1) * 127.5).round().to(torch.uint8).permute(1, 2, 3, 0).cpu().numpy()
        _, hauteur, largeur, _ = images.shape
        chemin = os.path.join(dossier, "clip.mp4")
        derniere = ecrire_mp4_muet(iter(images), nombre, largeur, hauteur, chemin)
        calcul = time.time() - debut
        signaler("envoi", None, f"dépôt du clip muet ({nombre} images)", forcer=True)
        with open(chemin, "rb") as f:
            deposer(entree["upload_url"], f, "video/mp4")
    resultat = {
        "video_path": entree["video_path"],
        "images": nombre,
        "duree": round(nombre / 25, 3),
        "duree_voix": round(duree, 3),
        "taille": f"{largeur}x{hauteur}",
        "secondes": round(calcul, 1),
        "audio": False,
    }
    if entree.get("last_frame_upload_url") and entree.get("last_frame_path"):
        tampon = BytesIO()
        Image.fromarray(derniere).save(tampon, format="JPEG", quality=95)
        try:
            deposer(entree["last_frame_upload_url"], tampon.getvalue(), "image/jpeg", 120)
            resultat["last_frame_path"] = entree["last_frame_path"]
        except RuntimeError as e:
            print(f"Dernière image refusée : {e}")
    return resultat


def handler(job):
    try:
        refus = carte_refusee(job)
        if refus:
            return refus
        entree = job["input"]
        commencer(job)
        if entree.get("mode", "lipsync") != "lipsync":
            return {"error": f"Métier inconnu : {entree.get('mode')}"}
        return generer(entree)
    except Exception as e:
        traceback.print_exc()
        return {"error": f"{type(e).__name__} : {e}"[:500]}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
