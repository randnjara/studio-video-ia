# Découpe de la voix off : morceaux WAV 16 kHz mono exacts et bout à bout, recalage sur les silences.
# Lancer : python3 worker-voix/test_decoupage.py (numpy, soundfile et ffmpeg)
import sys, os, tempfile, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, soundfile as sf
import decoupage as d

dossier = tempfile.mkdtemp()
sr = 44100
# voix de 10 s : « mots » (bruit modulé) séparés par des silences à 3.3 s et 6.6 s
t = np.arange(int(10*sr))/sr
son = 0.3*np.sin(2*np.pi*220*t)*(1+0.5*np.sin(2*np.pi*3*t))
for a,b in [(3.2,3.45),(6.5,6.75)]:
    son[int(a*sr):int(b*sr)] = 0
src = os.path.join(dossier, "voix.wav"); sf.write(src, np.stack([son,son],1), sr)
mp3 = os.path.join(dossier, "voix.mp3"); subprocess.run(["ffmpeg","-v","error","-y","-i",src,mp3],check=True)

# 1. sans recalage : 3 plans de 3.33 s, durées exactes, bout à bout
m = [{"scene_id":f"s{i}","debut":i*10/3,"fin":(i+1)*10/3} for i in range(3)]
dec, rec = d.preparer(mp3, m, 10.0, False, "mg", "k", dossier)
for mm, ch, a, b, du in dec:
    info = sf.info(ch)
    assert info.samplerate == 16000 and info.channels == 1, info
    assert abs(info.frames/16000 - du) < 1e-9
    print(mm["scene_id"], round(a,4), round(b,4), round(du,4))
assert not rec
assert abs(dec[0][3]-dec[1][2]) < 1e-9 and abs(dec[1][3]-dec[2][2]) < 1e-9
# un segment de 5 s → 5 s exactement
dec5, _ = d.preparer(mp3, [{"scene_id":"x","debut":2.0,"fin":7.0}], 10.0, False, "", "k", dossier)
assert abs(dec5[0][4]-5.0) < 1/16000, dec5[0][4]
print("5 s ->", dec5[0][4])

# 2. recalage : le tableau prévoyait 9 s (coupures à 3 et 6), la voix réelle fait 10 s
m = [{"scene_id":"a","debut":0,"fin":3.0},{"scene_id":"b","debut":3.0,"fin":6.0},{"scene_id":"c","debut":6.0,"fin":9.0}]
dec, rec = d.preparer(mp3, m, 9.0, True, "mg", "k2", dossier)
assert rec
print([ (mm["scene_id"], round(a,3), round(b,3)) for mm,_,a,b,_ in dec])
assert abs(dec[0][3]-3.325) < 0.08 and abs(dec[1][3]-6.625) < 0.08, "coupures dans les silences"
assert abs(dec[2][3]-10.0) < 0.01
print("OK")
