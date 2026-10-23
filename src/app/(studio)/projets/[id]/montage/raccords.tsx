"use client";

import { useState } from "react";

// Contrôle des raccords, gratuit : compare dans le navigateur la dernière image d'un clip et la première du suivant.
// Rien n'est envoyé à un service : les vidéos sont lues ici, image par image.
type Clip = { url: string; libelle: string };
type Raccord = {
  de: string;
  vers: string;
  note: number | null;
  fin?: string;
  debut?: string;
  finGrande?: string;
};

const L = 64;
const H = 36;

function image(url: string, quand: "debut" | "fin"): Promise<{ petite: ImageData; apercu: string; grande: string }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    v.onerror = () => reject(new Error("lecture"));
    v.onloadedmetadata = () => {
      v.currentTime = quand === "debut" ? 0.05 : Math.max(0, v.duration - 0.08);
    };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = L;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, L, H);
        const petite = ctx.getImageData(0, 0, L, H);
        const apercuCanvas = document.createElement("canvas");
        apercuCanvas.width = 240;
        apercuCanvas.height = Math.round((240 * v.videoHeight) / v.videoWidth) || 135;
        apercuCanvas.getContext("2d")!.drawImage(v, 0, 0, apercuCanvas.width, apercuCanvas.height);
        const grande = document.createElement("canvas");
        grande.width = v.videoWidth;
        grande.height = v.videoHeight;
        grande.getContext("2d")!.drawImage(v, 0, 0);
        resolve({ petite, apercu: apercuCanvas.toDataURL("image/jpeg", 0.8), grande: grande.toDataURL("image/jpeg", 0.92) });
      } catch (e) {
        reject(e);
      }
    };
  });
}

// Ressemblance de 0 à 1 : couleurs générales (histogrammes) et composition (luminosité point par point)
function ressemblance(a: ImageData, b: ImageData) {
  const bins = 8;
  const ha = new Array(bins * 3).fill(0);
  const hb = new Array(bins * 3).fill(0);
  let ecart = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      ha[k * bins + (a.data[i + k] >> 5)]++;
      hb[k * bins + (b.data[i + k] >> 5)]++;
    }
    const la = 0.299 * a.data[i] + 0.587 * a.data[i + 1] + 0.114 * a.data[i + 2];
    const lb = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
    ecart += Math.abs(la - lb) / 255;
  }
  const n = a.data.length / 4;
  let commun = 0;
  for (let k = 0; k < ha.length; k++) commun += Math.min(ha[k], hb[k]);
  const couleurs = commun / (3 * n);
  const composition = 1 - ecart / n;
  return 0.5 * couleurs + 0.5 * composition;
}

function verdict(note: number) {
  if (note >= 0.8) return { texte: "Bon raccord", classe: "bg-succes-doux text-succes" };
  if (note >= 0.65) return { texte: "Raccord moyen", classe: "bg-accent-doux text-accent" };
  return { texte: "Rupture", classe: "bg-alerte-doux text-alerte" };
}

export function ControleRaccords({ clips }: { clips: Clip[] }) {
  const [raccords, setRaccords] = useState<Raccord[] | null>(null);
  const [enCours, setEnCours] = useState(false);

  if (clips.length < 2) return null;

  async function controler() {
    setEnCours(true);
    const res: Raccord[] = [];
    for (let i = 0; i < clips.length - 1; i++) {
      const [a, b] = [clips[i], clips[i + 1]];
      try {
        const [fin, debut] = await Promise.all([image(a.url, "fin"), image(b.url, "debut")]);
        res.push({
          de: a.libelle,
          vers: b.libelle,
          note: ressemblance(fin.petite, debut.petite),
          fin: fin.apercu,
          debut: debut.apercu,
          finGrande: fin.grande,
        });
      } catch {
        res.push({ de: a.libelle, vers: b.libelle, note: null });
      }
      setRaccords([...res]);
    }
    setEnCours(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="bouton-discret" onClick={controler} disabled={enCours}>
          {enCours ? "Contrôle en cours…" : "🔍 Contrôler les raccords (gratuit)"}
        </button>
        <span className="text-xs text-sourdine">Compare la fin de chaque clip avec le début du suivant.</span>
      </div>
      {raccords?.map((r) => {
        const v = r.note === null ? null : verdict(r.note);
        return (
          <div key={`${r.de}-${r.vers}`} className="rounded-lg border border-ligne p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <b>
                {r.de} → {r.vers}
              </b>
              {v ? (
                <span className={`pastille ${v.classe}`}>
                  {v.texte} · {Math.round((r.note ?? 0) * 100)} %
                </span>
              ) : (
                <span className="text-sourdine">Contrôle impossible pour ces deux clips.</span>
              )}
            </div>
            {r.fin && r.debut && (
              <div className="mt-2 flex flex-wrap gap-2">
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.fin} alt={`Fin de ${r.de}`} className="h-20 rounded" />
                  <figcaption className="text-xs text-sourdine">Fin de {r.de}</figcaption>
                </figure>
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.debut} alt={`Début de ${r.vers}`} className="h-20 rounded" />
                  <figcaption className="text-xs text-sourdine">Début de {r.vers}</figcaption>
                </figure>
              </div>
            )}
            {r.note !== null && r.note < 0.8 && (
              <p className="mt-2 text-sourdine">
                Normal si l'histoire change de lieu ou de moment. Si l'action continue, refaites la photo de départ de {r.vers}{" "}
                à partir de la dernière image de {r.de}, puis régénérez {r.vers}.{" "}
                {r.finGrande && (
                  <a className="text-accent underline" href={r.finGrande} download={`fin-${r.de.replace(/\s+/g, "-")}.jpg`}>
                    Télécharger la dernière image de {r.de}
                  </a>
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
