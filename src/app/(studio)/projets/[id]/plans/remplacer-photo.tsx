"use client";

import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { envoyerPhoto } from "@/lib/envoi-photo";
import { attacherPhotos } from "./actions";

// Remplace la photo d'un plan par une photo choisie sur l'ordinateur ou le téléphone, en un clic
export function RemplacerPhoto({ projectId, sceneId }: { projectId: string; sceneId: string }) {
  const champ = useRef<HTMLInputElement>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className="bouton-discret px-3 py-1" disabled={enCours} onClick={() => champ.current?.click()}>
        {enCours ? <Roue /> : "📷"} {enCours ? "Envoi de la photo…" : "Remplacer par ma propre photo"}
      </button>
      <input
        ref={champ}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          e.target.value = "";
          if (!fichier) return;
          setErreur(null);
          demarrer(async () => {
            try {
              const chemin = await envoyerPhoto(projectId, fichier);
              await attacherPhotos(projectId, [{ sceneId, chemin }], `#plan-${sceneId}`);
            } catch (err) {
              unstable_rethrow(err);
              setErreur(err instanceof Error ? err.message : "Envoi impossible. Réessayez.");
            }
          });
        }}
      />
      {erreur && <span className="text-alerte">{erreur}</span>}
    </div>
  );
}
