"use client";

import { useEffect, useState } from "react";

type Image = { numero: number; src: string | null; voix: string; duree: number; detail: string };

const RATIO: Record<string, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1" };

export function Diaporama({ images, format }: { images: Image[]; format: string }) {
  const [courant, setCourant] = useState<number | null>(null);
  const [lecture, setLecture] = useState(false);
  const ratio = RATIO[format] ?? "16 / 9";

  // Lecture : chaque photo reste affichée la durée de son plan
  useEffect(() => {
    if (!lecture || courant === null) return;
    if (courant >= images.length - 1) {
      setLecture(false);
      return;
    }
    const t = setTimeout(() => setCourant(courant + 1), images[courant].duree * 1000);
    return () => clearTimeout(t);
  }, [lecture, courant, images]);

  // Flèches du clavier et Échap
  useEffect(() => {
    if (courant === null) return;
    const touche = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setCourant((c) => Math.min((c ?? 0) + 1, images.length - 1));
      if (e.key === "ArrowLeft") setCourant((c) => Math.max((c ?? 0) - 1, 0));
      if (e.key === "Escape") {
        setCourant(null);
        setLecture(false);
      }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [courant, images.length]);

  const image = courant === null ? null : images[courant];

  return (
    <>
      <div>
        <button
          type="button"
          className="bouton"
          disabled={images.length === 0}
          onClick={() => {
            setCourant(0);
            setLecture(true);
          }}
        >
          ▶ Lecture du premier au dernier plan
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {images.map((p, i) => (
          <button
            key={p.numero}
            type="button"
            onClick={() => {
              setCourant(i);
              setLecture(false);
            }}
            className="group relative overflow-hidden rounded-md bg-surface-2 text-left"
            style={{ aspectRatio: ratio }}
            title={p.voix}
          >
            {p.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.src} alt={`Plan ${p.numero}`} className="h-full w-full object-cover transition group-hover:opacity-80" />
            ) : (
              <span className="flex h-full items-center justify-center p-1 text-center text-xs text-sourdine">Photo à créer</span>
            )}
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-xs text-white">{p.numero}</span>
          </button>
        ))}
      </div>

      {image && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/95 p-4 text-white">
          <div className="relative flex max-h-[80vh] w-full flex-1 items-center justify-center">
            {image.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.src} alt={`Plan ${image.numero}`} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-sm opacity-70">Plan {image.numero} : photo à créer</span>
            )}
          </div>
          <p className="max-w-2xl text-center text-base">{image.voix}</p>
          <p className="text-xs opacity-70">
            Plan {image.numero} / {images.length} · {image.duree} s{image.detail ? ` · ${image.detail}` : ""}
          </p>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg bg-white/15 px-3 py-1.5" onClick={() => setCourant(Math.max(courant! - 1, 0))}>
              ← Précédent
            </button>
            <button type="button" className="rounded-lg bg-white/15 px-3 py-1.5" onClick={() => setLecture(!lecture)}>
              {lecture ? "⏸ Pause" : "▶ Lecture"}
            </button>
            <button
              type="button"
              className="rounded-lg bg-white/15 px-3 py-1.5"
              onClick={() => setCourant(Math.min(courant! + 1, images.length - 1))}
            >
              Suivant →
            </button>
            <button
              type="button"
              className="rounded-lg bg-white/15 px-3 py-1.5"
              onClick={() => {
                setCourant(null);
                setLecture(false);
              }}
            >
              ✕ Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
}
