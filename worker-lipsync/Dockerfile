# Serveur lip-sync du studio : InfiniteTalk (MeiGen-AI, licence Apache 2.0) sur Wan 2.1 image → vidéo 14B.
# Il reçoit une photo et un morceau de voix off ; la bouche suit la voix. La vidéo sort SANS son (la voix reste sur sa
# propre piste au montage), avec exactement autant d'images que la voix en demande (25 images/s).
FROM pytorch/pytorch:2.4.1-cuda12.1-cudnn9-devel

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    PYTHONPATH=/app/InfiniteTalk

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Code d'InfiniteTalk à une version fixe
ARG INFINITETALK_COMMIT=50aa0a94184315407a991ae804d9b58d6d311ba8
RUN git clone https://github.com/MeiGen-AI/InfiniteTalk /app/InfiniteTalk \
 && git -C /app/InfiniteTalk checkout "$INFINITETALK_COMMIT" \
 && rm -rf /app/InfiniteTalk/.git /app/InfiniteTalk/examples /app/InfiniteTalk/assets

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir xformers==0.0.28 --index-url https://download.pytorch.org/whl/cu121 \
 && python3 -m pip install --no-cache-dir -r requirements.txt \
 && python3 -m pip install --no-cache-dir ninja psutil packaging wheel \
 && python3 -m pip install --no-cache-dir flash_attn==2.7.4.post1 --no-build-isolation \
 && python3 -c "import torch, xformers, flash_attn, wan; print('torch', torch.__version__)"

# Petit encodeur de voix (wav2vec2 chinois, ≈ 400 Mo) rangé dans l'image ; Wan 2.1 vient du cache de RunPod (champ
# « Model » du serveur) et les poids InfiniteTalk et le LoRA rapide sont téléchargés au premier démarrage
RUN python3 -c "from huggingface_hub import snapshot_download as s, hf_hub_download as h; \
s('TencentGameMate/chinese-wav2vec2-base', local_dir='/app/poids/chinese-wav2vec2-base'); \
h('TencentGameMate/chinese-wav2vec2-base', 'model.safetensors', revision='refs/pr/1', local_dir='/app/poids/chinese-wav2vec2-base')"

COPY handler.py video.py ./
CMD ["python3", "-u", "handler.py"]
