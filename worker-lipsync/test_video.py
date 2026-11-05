# MP4 du lip-sync : durée = durée de la voix (± 1 image), aucune piste audio.
# Lancer : python3 worker-lipsync/test_video.py (numpy et ffmpeg)
import sys, os, json, subprocess, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from video import nombre_images, ecrire_mp4_muet, echantillons_minimum

d = tempfile.mkdtemp()
def sonde(p):
    o = json.loads(subprocess.run(["ffprobe","-v","error","-count_frames","-show_streams","-show_format","-of","json",p],capture_output=True,text=True).stdout)
    v = [s for s in o["streams"] if s["codec_type"]=="video"]
    a = [s for s in o["streams"] if s["codec_type"]=="audio"]
    return int(v[0]["nb_read_frames"]), len(a), float(v[0]["duration"])

for duree, generees in [(5.0, 129), (5.0, 120), (3.3333, 125), (1.2, 89)]:
    n = nombre_images(duree)
    imgs = (np.full((480, 832, 3), i % 255, np.uint8) for i in range(generees))
    p = os.path.join(d, f"c{duree}-{generees}.mp4")
    der = ecrire_mp4_muet(imgs, n, 832, 480, p)
    images, pistes_audio, dv = sonde(p)
    print(f"voix {duree}s -> {n} images attendues, {images} dans le MP4, {pistes_audio} piste audio, {dv:.3f}s")
    assert images == n and pistes_audio == 0
    assert abs(dv - duree) <= 1/25 + 1e-6, "durée ± 1 image"
assert echantillons_minimum() / 16000 * 25 > 81
print("OK")
