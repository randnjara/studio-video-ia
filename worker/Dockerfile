# Serveur de génération vidéo du studio : Wan 2.2 image → vidéo, version rapide en 4 étapes (Lightning)
FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

WORKDIR /app
COPY requirements.txt .
# Le Python de l'image est « géré par le système » : on installe à côté de PyTorch, sans environnement séparé
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt \
 && python3 -c "import torch, diffusers, runpod; print('torch', torch.__version__, 'diffusers', diffusers.__version__)"
COPY handler.py .

CMD ["python3", "-u", "handler.py"]
