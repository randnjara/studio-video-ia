"use client";

import { useEffect, useRef } from "react";

// Aperçu d'un clip avec son morceau de voix off. Les clips sortent muets (la voix est posée sur sa propre piste au
// montage) : ici, la voix du plan est jouée en même temps que la vidéo, pour vérifier la bouche avant de valider.
// La voix suit la vidéo : lecture, pause, déplacement dans la barre, boucle et volume de la vidéo.
export function VideoAvecVoix({ video, voix }: { video: string; voix?: string }) {
  const refVideo = useRef<HTMLVideoElement>(null);
  const refVoix = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const v = refVideo.current;
    const a = refVoix.current;
    if (!v || !a) return;
    let dernier = 0;
    const caler = () => {
      if (v.currentTime >= (Number.isFinite(a.duration) ? a.duration : Infinity)) {
        a.pause();
        return;
      }
      if (Math.abs(a.currentTime - v.currentTime) > 0.15) a.currentTime = v.currentTime;
    };
    const lire = () => {
      caler();
      if (v.currentTime < (Number.isFinite(a.duration) ? a.duration : Infinity)) a.play().catch(() => undefined);
    };
    const arreter = () => a.pause();
    const suivre = () => {
      // Retour au début (boucle) : la voix repart avec l'image
      if (v.currentTime + 0.3 < dernier && !v.paused) lire();
      dernier = v.currentTime;
      if (!v.paused) caler();
    };
    const son = () => {
      a.muted = v.muted;
      a.volume = v.volume;
    };
    const vitesse = () => {
      a.playbackRate = v.playbackRate;
    };
    v.addEventListener("play", lire);
    v.addEventListener("pause", arreter);
    v.addEventListener("waiting", arreter);
    v.addEventListener("playing", lire);
    v.addEventListener("seeked", caler);
    v.addEventListener("timeupdate", suivre);
    v.addEventListener("volumechange", son);
    v.addEventListener("ratechange", vitesse);
    return () => {
      v.removeEventListener("play", lire);
      v.removeEventListener("pause", arreter);
      v.removeEventListener("waiting", arreter);
      v.removeEventListener("playing", lire);
      v.removeEventListener("seeked", caler);
      v.removeEventListener("timeupdate", suivre);
      v.removeEventListener("volumechange", son);
      v.removeEventListener("ratechange", vitesse);
      a.pause();
    };
  }, [voix]);

  return (
    <div>
      <video ref={refVideo} src={video} controls loop playsInline preload="metadata" className="w-full rounded-md bg-black" />
      {voix && (
        <>
          <audio ref={refVoix} src={voix} preload="auto" className="hidden" />
          <p className="mt-1 text-xs text-sourdine">🔊 Aperçu avec la voix off du plan (le fichier du clip reste muet).</p>
        </>
      )}
    </div>
  );
}
