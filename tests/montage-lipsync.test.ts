// Lip-sync au montage : la bouche reste calée sur la voix off (piste séparée), même voix déplacée, et régler la voix ne
// touche pas la vidéo. Lancer : npm run test:lipsync
import { placer, timelineParDefaut, tempsSource, type Media, type Timeline } from "../src/lib/montage.ts";

const IPS = 25;
const voix = { chemin: "p/voix.wav", nom: "Voix off", duree: 15.2, debut: 0 };
// 3 scènes : morceaux de voix (début, fin) ; la vidéo lip-sync a round(durée × 25) images
const morceaux = [[0, 5.04], [5.04, 10.0], [10.0, 15.2]];
const clips: Media[] = morceaux.map(([a, b], i) => ({
  chemin: `p/essais/${i}.mp4`, nature: "video", nom: `Plan ${i + 1}`, takeId: `t${i}`, muet: true,
  duree: Math.round((b - a) * IPS) / IPS, voix: { ...voix, debut: a },
}));
let t: Timeline = timelineParDefaut(clips);
const verifier = (tl: Timeline, decalageVoix: number) => {
  const { places } = placer(tl);
  const pv = places.find((p) => p.element.nature === "audio")!;
  let pire = 0;
  for (const p of places.filter((p) => p.principale)) {
    // pour chaque image du film : temps dans la voix entendu vs temps de voix qui a guidé la bouche
    for (let n = Math.ceil(p.debut * IPS); n < Math.floor(p.fin * IPS); n++) {
      const x = n / IPS;
      const image = Math.floor(tempsSource(p, x) * IPS + 1e-6); // image du clip affichée
      const bouche = p.element.voix!.debut + image / IPS; // instant de voix de cette image
      const entendu = tempsSource(pv, x); // instant de voix entendu
      pire = Math.max(pire, Math.abs(bouche - entendu) * IPS);
    }
  }
  console.log(`voix à ${decalageVoix}s : décalage max voix/bouche = ${pire.toFixed(2)} image(s)`);
  if (pire >= 2) throw new Error("décalage ≥ 2 images");
};
verifier(t, 0);
// La voix déplacée de +1,5 s (intro) : les clips liés suivent
t = { ...t, pistes: t.pistes.map((p) => ({ ...p, elements: p.elements.map((e) => (e.nature === "audio" ? { ...e, debut: 1.5 } : e)) })) };
verifier(t, 1.5);
// Changer le volume ou les fondus de la voix : la vidéo ne bouge pas (rien à regénérer)
const avant = JSON.stringify(placer(t).places.filter((p) => p.principale).map((p) => [p.element.chemin, p.debut, p.fin]));
const t2 = { ...t, pistes: t.pistes.map((p) => ({ ...p, volume: p.nature === "audio" ? 0.4 : p.volume, elements: p.elements.map((e) => (e.nature === "audio" ? { ...e, volume: 0.5, entree: "fondu" as const, sortie: "fondu" as const } : e)) })) };
const apres = JSON.stringify(placer(t2).places.filter((p) => p.principale).map((p) => [p.element.chemin, p.debut, p.fin]));
if (avant !== apres) throw new Error("le volume de la voix a déplacé la vidéo");
console.log("volume/fondus de la voix : vidéo inchangée, aucune régénération");
// Délier : le clip revient bout à bout
const t3 = { ...t, pistes: t.pistes.map((p, i) => (i === 0 ? { ...p, elements: p.elements.map((e) => ({ ...e, lien: null })) } : p)) };
console.log("délié :", placer(t3).places.filter((p) => p.principale).map((p) => p.debut.toFixed(2)).join(", "));
console.log("OK");
