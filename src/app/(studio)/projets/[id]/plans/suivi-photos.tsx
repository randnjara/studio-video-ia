"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { actualiserPhotos } from "./actions";

// Tant que des photos de départ sont en création, demande des nouvelles au serveur toutes les 10 secondes.
export function SuiviPhotos({ projectId, enCours }: { projectId: string; enCours: number }) {
  const router = useRouter();
  const [secondes, setSecondes] = useState(0);

  useEffect(() => {
    if (enCours === 0) return;
    let actif = true;
    const debut = Date.now();
    const compteur = setInterval(() => setSecondes(Math.round((Date.now() - debut) / 1000)), 1000);
    const boucle = setInterval(async () => {
      const restants = await actualiserPhotos(projectId).catch(() => enCours);
      if (actif && restants !== enCours) router.refresh();
    }, 10_000);
    return () => {
      actif = false;
      clearInterval(compteur);
      clearInterval(boucle);
    };
  }, [projectId, enCours, router]);

  if (enCours === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-doux px-4 py-3 text-sm text-accent">
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="flex-1">
        {enCours === 1 ? "1 photo de départ en création" : `${enCours} photos de départ en création`} ({secondes} s). Comptez
        environ 15 secondes par photo une fois le serveur démarré (la toute première fois, quelques minutes de plus pour
        installer le modèle). Gardez cette page ouverte.
      </span>
    </div>
  );
}
