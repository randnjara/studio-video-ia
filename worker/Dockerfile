# Serveur de génération du studio, version rapide en 4 étapes (Lightning) :
# vidéos avec Wan 2.2 image → vidéo, photos de départ avec Qwen-Image-Edit (les deux sous licence Apache 2.0)
# CUDA 12.8 : cartes Blackwell (RTX PRO 6000 96 Go, B200 : sm_100 / sm_120) et celles d'avant (A100 sm_80, H100 sm_90).
# (torch 2.13 n'existe qu'en CUDA 12.6, sans Blackwell, ou en CUDA 13, qui exige des pilotes très récents chez RunPod)
FROM pytorch/pytorch:2.11.0-cuda12.8-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

WORKDIR /app
COPY requirements.txt .
# Le Python de l'image est « géré par le système » : on installe à côté de PyTorch, sans environnement séparé
RUN echo "torch==2.11.0" > /tmp/contraintes.txt \
 && python3 -m pip install --no-cache-dir --break-system-packages -c /tmp/contraintes.txt -r requirements.txt \
 && python3 -c "import torch, diffusers, runpod; print('torch', torch.__version__, 'diffusers', diffusers.__version__)" \
 && python3 -c "import torch; f = torch._C._cuda_getArchFlags(); print('torch', torch.__version__, 'CUDA', torch.version.cuda, f); assert 'sm_120' in f and 'sm_80' in f and 'sm_90' in f, f"
# Finitions (voir amelioration.py) : Real-ESRGAN pour la vidéo (licence BSD-3) et RIFE 4.7 (licence MIT), petits fichiers
RUN mkdir -p /app/modeles \
 && python3 -c "import urllib.request as u; \
u.urlretrieve('https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth', '/app/modeles/realesr-general-x4v3.pth'); \
u.urlretrieve('https://github.com/Fannovel16/ComfyUI-Frame-Interpolation/releases/download/models/rife47.pth', '/app/modeles/rife47.pth')"
COPY handler.py amelioration.py rife_arch.py progression.py gpu.py ./

CMD ["python3", "-u", "handler.py"]
