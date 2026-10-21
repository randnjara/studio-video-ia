"use client";

import { useEffect, useRef, useState } from "react";

// Aperçu du montage : lit les clips l'un après l'autre, comme la vidéo finale
export function LecteurMontage({ clips }: { clips: { url: string; libelle: string }[] }) {
  const [i, setI] = useState(0);
  const [lecture, setLecture] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (lecture) video.current?.play().catch(() => setLecture(false));
  }, [i, lecture]);

  if (clips.length === 0) {
    return <div className="flex aspect-video items-center justify-center rounded-lg bg-surface-2 text-sm text-sourdine">Aucun clip</div>;
  }
  const actuel = clips[Math.min(i, clips.length - 1)];

  return (
    <div className="flex flex-col gap-2">
      <video
        ref={video}
        key={actuel.url}
        src={actuel.url}
        controls
        playsInline
        preload="auto"
        className="aspect-video w-full rounded-lg bg-black"
        onPlay={() => setLecture(true)}
        onEnded={() => {
          if (i < clips.length - 1) setI(i + 1);
          else {
            setLecture(false);
            setI(0);
          }
        }}
      />
      <div className="flex items-center gap-2 text-sm">
        <button type="button" className="bouton px-3 py-1" onClick={() => (setI(0), setLecture(true))}>
          ▶ Lire tout le montage
        </button>
        <span className="text-sourdine">
          {actuel.libelle} · clip {Math.min(i, clips.length - 1) + 1} / {clips.length}
        </span>
      </div>
    </div>
  );
}
