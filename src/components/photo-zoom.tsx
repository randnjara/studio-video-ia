"use client";

import { useRef } from "react";

// Miniature cliquable : la photo s'ouvre en plein écran (clic ou Échap pour fermer)
export function PhotoZoom({ src, alt = "", className = "" }: { src: string; alt?: string; className?: string }) {
  const dialogue = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialogue.current?.showModal()} className="shrink-0 cursor-zoom-in" title="Agrandir">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} />
      </button>
      <dialog
        ref={dialogue}
        onClick={() => dialogue.current?.close()}
        className="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/90"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="max-h-[95vh] max-w-[95vw] cursor-zoom-out object-contain" />
      </dialog>
    </>
  );
}
