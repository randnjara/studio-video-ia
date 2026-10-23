# Serveur du studio voix : Meta MMS (malgache), Kokoro, Chatterbox (multilingue, copie de voix, conversion).
# Séparé du serveur vidéo : il tourne sur une petite carte graphique, avec ses propres versions de bibliothèques.
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    HF_HOME=/modeles

# ffmpeg lit les enregistrements MP3, M4A et WebM (micro du navigateur) ; espeak-ng prononce les langues sans dictionnaire
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt \
 && python3 -c "import torch, chatterbox, kokoro; print('torch', torch.__version__)"

# Les modèles sont rangés dans l'image : pas de téléchargement à chaque démarrage du serveur
COPY precharger.py .
RUN python3 precharger.py

COPY handler.py .
CMD ["python3", "-u", "handler.py"]
