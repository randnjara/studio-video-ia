"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { actualiserEssais } from "./actions";

// Tant qu'un essai tourne, demande des nouvelles à RunPod toutes les 10 secondes et rafraîchit la page.
export function SuiviEssais({ projectId, enCours }: { projectId: string; enCours: number }) {
  const router = useRouter();
  const [secondes, setSecondes] = useState(0);

  useEffect(() => {
    if (enCours === 0) return;
    let actif = true;
    const debut = Date.now();
    const compteur = setInterval(() => setSecondes(Math.round((Date.now() - debut) / 1000)), 1000);
    const boucle = setInterval(async () => {
      const restants = await actualiserEssais(projectId).catch(() => enCours);
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
    <p className="rounded-md bg-accent-doux px-4 py-2 text-sm">
      {enCours === 1 ? "1 vidéo en cours de génération" : `${enCours} vidéos en cours de génération`} (
      {secondes} s). Comptez 1 à 4 minutes par plan. Gardez cette page ouverte (ou revenez-y dans les 20 minutes) pour que la vidéo soit rangée dans le projet.
    </p>
  );
}
