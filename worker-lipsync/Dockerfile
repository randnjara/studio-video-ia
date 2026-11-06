# Serveur lip-sync du studio : InfiniteTalk (MeiGen-AI, licence Apache 2.0) sur Wan 2.1 image → vidéo 14B.
# Il reçoit une photo et un morceau de voix off ; la bouche suit la voix. La vidéo sort SANS son (la voix reste sur sa
# propre piste au montage), avec exactement autant d'images que la voix en demande (25 images/s).
# Image « devel » : Triton (utilisé par xformers) a besoin d'un compilateur C sur le serveur.
# CUDA 12.8 + torch 2.7.1 : cartes Blackwell (sm_120) et celles d'avant (sm_80 à sm_90).
FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel

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
 && rm -rf /app/InfiniteTalk/.git /app/InfiniteTalk/examples /app/InfiniteTalk/assets \
 && sed -i '/^from inspect import ArgSpec$/d' /app/InfiniteTalk/wan/multitalk.py \
 && ! grep -rn "ArgSpec" /app/InfiniteTalk --include=*.py
# wan/multitalk.py importe « inspect.ArgSpec » (jamais utilisé), retiré de Python 3.11 : sans cette ligne supprimée,
# chaque clip lip-sync échouait avec « ImportError: cannot import name 'ArgSpec' from 'inspect' ».

COPY requirements.txt .
# Versions liées entre elles : torch 2.7.1 + CUDA 12.8 (déjà dans l'image, Python 3.11), xformers 0.0.31.post1 (roue PyPI
# faite pour torch 2.7.1) et la roue précompilée de flash-attn 2.8.0.post2 pour CUDA 12 / torch 2.7 / Python 3.11, dans l'ABI C++
# du torch installé (lue ci-dessous). Rien n'est compilé : la machine de construction n'a pas de carte graphique.
# Si flash-attn n'a pas de code pour la carte, le serveur passe à l'attention de PyTorch (voir handler.py).
# « contraintes » empêche requirements.txt de changer la version de torch. Une dépendance tire « opencv-python » (qui veut
# libGL, absente de l'image) : on garde seulement la version « headless » de cv2.
# 2.8.0.post2 : la plus récente acceptée par xformers 0.0.31.post1 (« >=2.7.1,<=2.8.0 », comparé sur les 3 premiers chiffres)
ARG FLASH_ATTN_VERSION=2.8.0.post2
RUN echo "torch==2.7.1" > /tmp/contraintes.txt \
 && python3 -m pip install --no-cache-dir -c /tmp/contraintes.txt xformers==0.0.31.post1 \
 && python3 -m pip install --no-cache-dir -c /tmp/contraintes.txt -r requirements.txt \
 && ABI=$(python3 -c "import torch; print('TRUE' if torch._C._GLIBCXX_USE_CXX11_ABI else 'FALSE')") \
 && python3 -m pip install --no-cache-dir --no-deps \
      "https://github.com/Dao-AILab/flash-attention/releases/download/v${FLASH_ATTN_VERSION}/flash_attn-${FLASH_ATTN_VERSION}+cu12torch2.7cxx11abi${ABI}-cp311-cp311-linux_x86_64.whl" \
 && python3 -m pip uninstall -y opencv-python \
 && python3 -m pip install --no-cache-dir --no-deps --force-reinstall opencv-python-headless==4.10.0.84 \
 && (python3 -m pip check || echo "pip check : avertissements ci-dessus (non bloquants)")
# Vérification sans carte graphique : versions, architectures (Blackwell comprise) et bibliothèques compilées chargées.
# « wan » n'est pas importé ici : xfuser interroge la carte graphique dès son import (au démarrage du serveur, sur RunPod).
RUN python3 -c "import torch, xformers, xformers.ops, flash_attn, flash_attn_2_cuda, cv2, decord, librosa; \
assert torch.__version__.startswith('2.7.1'), torch.__version__; \
assert flash_attn.__version__ == '${FLASH_ATTN_VERSION}', flash_attn.__version__; \
print('torch', torch.__version__, 'xformers', xformers.__version__, 'flash_attn', flash_attn.__version__)" \
 && python3 -c "import torch; f = torch._C._cuda_getArchFlags(); print('torch', torch.__version__, 'CUDA', torch.version.cuda, f); assert 'sm_120' in f and 'sm_80' in f and 'sm_90' in f, f" \
 && test -f /app/InfiniteTalk/wan/multitalk.py

# Petit encodeur de voix (wav2vec2 chinois, ≈ 400 Mo) rangé dans l'image ; Wan 2.1 vient du cache de RunPod (champ
# « Model » du serveur) et les poids InfiniteTalk et le LoRA rapide sont téléchargés au premier démarrage
RUN python3 -c "from huggingface_hub import snapshot_download as s, hf_hub_download as h; \
s('TencentGameMate/chinese-wav2vec2-base', local_dir='/app/poids/chinese-wav2vec2-base'); \
h('TencentGameMate/chinese-wav2vec2-base', 'model.safetensors', revision='refs/pr/1', local_dir='/app/poids/chinese-wav2vec2-base')"

COPY handler.py video.py progression.py gpu.py ./
CMD ["python3", "-u", "handler.py"]
