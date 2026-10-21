# Serveur de génération vidéo du studio : Wan 2.2 image → vidéo, version rapide en 4 étapes (Lightning)
FROM pytorch/pytorch:2.13.0-cuda12.6-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY handler.py .

CMD ["python", "-u", "handler.py"]
