"""Télécharge les modèles pendant la construction de l'image, pour que le serveur démarre sans attendre."""

from huggingface_hub import snapshot_download
from transformers import AutoTokenizer, VitsModel

# Meta MMS malgache
VitsModel.from_pretrained("facebook/mms-tts-mlg")
AutoTokenizer.from_pretrained("facebook/mms-tts-mlg")

# Kokoro : le modèle et toutes ses voix, puis chaque langue (dictionnaires de prononciation)
snapshot_download("hexgrad/Kokoro-82M")
from kokoro import KModel, KPipeline  # noqa: E402

modele = KModel(repo_id="hexgrad/Kokoro-82M").eval()
ESSAIS = {
    "a": ("af_heart", "Hello."),
    "b": ("bf_emma", "Hello."),
    "e": ("ef_dora", "Hola."),
    "f": ("ff_siwis", "Bonjour."),
    "h": ("hf_alpha", "नमस्ते।"),
    "i": ("if_sara", "Ciao."),
    "p": ("pf_dora", "Olá."),
    "z": ("zf_xiaobei", "你好。"),
}
for langue, (voix, texte) in ESSAIS.items():
    lecteur = KPipeline(lang_code=langue, repo_id="hexgrad/Kokoro-82M", model=modele)
    for _ in lecteur(texte, voice=voix):
        pass

# Chatterbox multilingue et conversion de voix
from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # noqa: E402
from chatterbox.vc import ChatterboxVC  # noqa: E402

ChatterboxMultilingualTTS.from_pretrained(device="cpu")
ChatterboxVC.from_pretrained("cpu")
print("Modèles prêts")
