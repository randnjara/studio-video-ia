# Serveur lip-sync du studio : InfiniteTalk (MeiGen-AI, licence Apache 2.0) sur Wan 2.1 image → vidéo 14B.
# Il reçoit une photo et un morceau de voix off ; la bouche suit la voix. La vidéo sort SANS son (la voix reste sur sa
# propre piste au montage), avec exactement autant d'images que la voix en demande (25 images/s).
# Image « devel » : Triton (utilisé par xformers) a besoin d'un compilateur C sur le serveur
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
# Versions liées entre elles : torch 2.4.1 (déjà dans l'image, CUDA 12.1, Python 3.11), xformers 0.0.28.post1 (roue PyPI
# faite pour torch 2.4.1 + CUDA 12.1, elle demande torch==2.4.1) et la roue précompilée de flash-attn 2.7.4.post1 pour CUDA 12 / torch 2.4 / Python 3.11 (ABI C++ « FALSE »,
# celle des roues pip de PyTorch). Rien n'est compilé : la machine de construction n'a pas de carte graphique.
# « contraintes » empêche requirements.txt de changer la version de torch. Une dépendance tire « opencv-python » (qui veut
# libGL, absente de l'image) : on garde seulement la version « headless » de cv2.
ARG FLASH_ATTN_WHEEL=https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1+cu12torch2.4cxx11abiFALSE-cp311-cp311-linux_x86_64.whl
RUN echo "torch==2.4.1" > /tmp/contraintes.txt \
 && python3 -m pip install --no-cache-dir -c /tmp/contraintes.txt xformers==0.0.28.post1 \
 && python3 -m pip install --no-cache-dir -c /tmp/contraintes.txt -r requirements.txt \
 && python3 -m pip install --no-cache-dir --no-deps "$FLASH_ATTN_WHEEL" \
 && python3 -m pip uninstall -y opencv-python \
 && python3 -m pip install --no-cache-dir --no-deps --force-reinstall opencv-python-headless==4.10.0.84 \
 && (python3 -m pip check || echo "pip check : avertissements ci-dessus (non bloquants)")
# Vérification sans carte graphique : versions et bibliothèques compilées chargées. « wan » n'est pas importé ici :
# xfuser interroge la carte graphique dès son import (il est importé au démarrage du serveur, sur RunPod).
RUN python3 -c "import torch, xformers, xformers.ops, flash_attn, flash_attn_2_cuda, cv2, decord, librosa; \
assert torch.__version__.startswith('2.4.1'), torch.__version__; \
assert flash_attn.__version__ == '2.7.4.post1', flash_attn.__version__; \
print('torch', torch.__version__, 'xformers', xformers.__version__, 'flash_attn', flash_attn.__version__)" \
 && test -f /app/InfiniteTalk/wan/multitalk.py

# Petit encodeur de voix (wav2vec2 chinois, ≈ 400 Mo) rangé dans l'image ; Wan 2.1 vient du cache de RunPod (champ
# « Model » du serveur) et les poids InfiniteTalk et le LoRA rapide sont téléchargés au premier démarrage
RUN python3 -c "from huggingface_hub import snapshot_download as s, hf_hub_download as h; \
s('TencentGameMate/chinese-wav2vec2-base', local_dir='/app/poids/chinese-wav2vec2-base'); \
h('TencentGameMate/chinese-wav2vec2-base', 'model.safetensors', revision='refs/pr/1', local_dir='/app/poids/chinese-wav2vec2-base')"

COPY handler.py video.py progression.py ./
CMD ["python3", "-u", "handler.py"]
