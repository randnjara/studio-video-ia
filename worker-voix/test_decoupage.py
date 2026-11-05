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
r = d.preparer(mp3, m, 10.0, False, "mg", "k", dossier); dec, rec = r["decoupes"], r["recale"]
for mm, ch, a, b, du in dec:
    info = sf.info(ch)
    assert info.samplerate == 16000 and info.channels == 1, info
    assert abs(info.frames/16000 - du) < 1e-9
    print(mm["scene_id"], round(a,4), round(b,4), round(du,4))
assert not rec
assert abs(dec[0][3]-dec[1][2]) < 1e-9 and abs(dec[1][3]-dec[2][2]) < 1e-9
# un segment de 5 s → 5 s exactement
dec5 = d.preparer(mp3, [{"scene_id":"x","debut":2.0,"fin":7.0}], 10.0, False, "", "k", dossier)["decoupes"]
assert abs(dec5[0][4]-5.0) < 1/16000, dec5[0][4]
print("5 s ->", dec5[0][4])

# 2. recalage : le tableau prévoyait 9 s (coupures à 3 et 6), la voix réelle fait 10 s
m = [{"scene_id":"a","debut":0,"fin":3.0},{"scene_id":"b","debut":3.0,"fin":6.0},{"scene_id":"c","debut":6.0,"fin":9.0}]
r = d.preparer(mp3, m, 9.0, True, "mg", "k2", dossier); dec, rec = r["decoupes"], r["recale"]
assert rec
print([ (mm["scene_id"], round(a,3), round(b,3)) for mm,_,a,b,_ in dec])
assert abs(dec[0][3]-3.325) < 0.08 and abs(dec[1][3]-6.625) < 0.08, "coupures dans les silences"
assert abs(dec[2][3]-10.0) < 0.01

# 3. Cas réel (projet Maman) : voix off de 17,1 s qui ne couvre que les premiers plans d'un film de 76 plans (357 s),
#    plans de 4+5+5+4+5… s, sans minutage du tableau : bout à bout depuis 0, jamais mis à l'échelle
t = np.arange(int(17.1*sr))/sr
voix = 0.3*np.sin(2*np.pi*200*t)*(1+0.5*np.sin(2*np.pi*3*t))
for a in (3.8, 8.9, 13.9):
    voix[int(a*sr):int((a+0.3)*sr)] = 0
courte = os.path.join(dossier, "plan1.wav"); sf.write(courte, voix, sr)
durees = ([4, 5, 5, 4, 5, 4, 5, 5] * 10)[:76]
durees[-1] += 357 - sum(durees)
plans, curseur = [], 0.0
for i, du in enumerate(durees):
    plans.append({"scene_id": f"p{i+1}", "debut": curseur, "fin": curseur + du}); curseur += du
assert abs(curseur - 357) < 1e-9
attendu = [("p1", 0, 4), ("p2", 4, 9), ("p3", 9, 14), ("p4", 14, 17.1)]
for recalage in (False, True):
    r = d.preparer(courte, plans, 357.0, recalage, "mg", f"maman{recalage}", dossier)
    obtenu = [(m["scene_id"], round(a, 2), round(b, 2)) for m, _, a, b, _ in r["decoupes"]]
    print("recaler" if recalage else "sans recaler", obtenu, f"{len(r['ignores'])} plans sans voix", r["avertissement"] or "")
    assert len(r["ignores"]) == 72 and r["ignores"][0] == "p5"
    assert [o[0] for o in obtenu] == ["p1", "p2", "p3", "p4"]
    for (_, a, b), (_, ea, eb) in zip(obtenu, attendu):
        # sans recaler : exact ; avec recaler (écart > 20 %) : pas d'échelle, coupure au plus près d'un silence (± 0,6 s)
        tol = 0.6 if recalage else 0.001
        assert abs(a - ea) <= tol and abs(b - eb) <= tol, (a, b, ea, eb)
    assert obtenu[0][2] > 3 and (r["avertissement"] is not None) == recalage
# Même voix, plans couverts seulement (fin prévue 18 s, écart 5 %) : le recalage met à l'échelle sans rien perdre
r = d.preparer(courte, plans[:5], 18.0, True, "mg", "maman18", dossier)
assert r["recale"] and r["avertissement"] is None and r["decoupes"][-1][3] == 17.1, r
print("OK")
