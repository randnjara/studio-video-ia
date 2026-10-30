# Serveur de génération du studio, version rapide en 4 étapes (Lightning) :
# vidéos avec Wan 2.2 image → vidéo, photos de départ avec Qwen-Image-Edit (les deux sous licence Apache 2.0)
FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

WORKDIR /app
COPY requirements.txt .
# Le Python de l'image est « géré par le système » : on installe à côté de PyTorch, sans environnement séparé
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt \
 && python3 -c "import torch, diffusers, runpod; print('torch', torch.__version__, 'diffusers', diffusers.__version__)"
# Finitions (voir amelioration.py) : Real-ESRGAN pour la vidéo (licence BSD-3) et RIFE 4.7 (licence MIT), petits fichiers
RUN mkdir -p /app/modeles \
 && python3 -c "import urllib.request as u; \
u.urlretrieve('https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth', '/app/modeles/realesr-general-x4v3.pth'); \
u.urlretrieve('https://github.com/Fannovel16/ComfyUI-Frame-Interpolation/releases/download/models/rife47.pth', '/app/modeles/rife47.pth')"
COPY handler.py amelioration.py rife_arch.py ./

CMD ["python3", "-u", "handler.py"]
