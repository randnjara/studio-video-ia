# Serveur du studio voix : Meta MMS (malgache), Kokoro, Chatterbox (multilingue, copie de voix, conversion).
# Séparé du serveur vidéo : il tourne sur une petite carte graphique, avec ses propres versions de bibliothèques.
# CUDA 12.8 : les cartes Blackwell (RTX PRO 6000, MIG 1g.24gb : sm_120) comme celles d'avant (sm_80 à sm_90).
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    HF_HOME=/modeles

# ffmpeg lit les enregistrements MP3, M4A et WebM (micro du navigateur) ; espeak-ng prononce les langues sans dictionnaire
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# « contraintes » : rien ne remplace le torch de l'image ; torchaudio de la même version, construit pour CUDA 12.8
RUN echo "torch==2.7.1" > /tmp/contraintes.txt \
 && (python3 -c "import torchaudio" || python3 -m pip install --no-cache-dir torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128) \
 && echo "torchaudio==2.7.1" >> /tmp/contraintes.txt \
 && python3 -m pip install --no-cache-dir -c /tmp/contraintes.txt -r requirements.txt \
 && python3 -m pip install --no-cache-dir --no-deps chatterbox-tts==0.1.7 \
 && python3 -c "import torch, torchaudio, chatterbox, kokoro, faster_whisper; print('torchaudio', torchaudio.__version__)" \
 && python3 -c "import torch; f = torch._C._cuda_getArchFlags(); print('torch', torch.__version__, 'CUDA', torch.version.cuda, f); assert 'sm_120' in f and 'sm_80' in f and 'sm_90' in f, f"

# Les modèles sont rangés dans l'image : pas de téléchargement à chaque démarrage du serveur
COPY precharger.py .
RUN python3 precharger.py

COPY handler.py decoupage.py alignement.py ton.py progression.py gpu.py ./
CMD ["python3", "-u", "handler.py"]
