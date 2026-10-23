"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { actualiserPhotos } from "./actions";

// Tant que des photos de départ sont en création, demande des nouvelles au serveur toutes les 10 secondes.
export function SuiviPhotos({
  projectId,
  enCours,
  depuis,
  lot,
}: {
  projectId: string;
  enCours: number;
  // Heure de la demande du lot et nombre de photos demandées ensemble, pour que le compteur ne reparte pas de zéro
  depuis: string;
  lot: number;
}) {
  const router = useRouter();
  const [secondes, setSecondes] = useState(0);

  useEffect(() => {
    if (enCours === 0) return;
    let actif = true;
    const debut = depuis ? new Date(depuis).getTime() : Date.now();
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
  }, [projectId, enCours, depuis, router]);

  if (enCours === 0) return null;
  // Mesuré sur le serveur photo : environ 1 min de démarrage, puis 10 à 15 s par photo
  const prevu = DEMARRAGE_S + PAR_PHOTO_S * Math.max(lot, enCours);
  const enRetard = secondes > prevu * 2;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm ${enRetard ? "bg-alerte-doux text-alerte" : "bg-accent-doux text-accent"}`}
    >
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="flex-1">
        {enCours === 1 ? "1 photo de départ en création" : `${enCours} photos de départ en création`} : {duree(secondes)}{" "}
        sur environ {duree(prevu)} prévues. Gardez cette page ouverte.
        {enRetard &&
          " C'est beaucoup plus long que prévu : le serveur RunPod est peut-être occupé. Une photo qui n'a pas pu partir passe en échec toute seule après 3 minutes, et vous pourrez la relancer."}
      </span>
    </div>
  );
}

const DEMARRAGE_S = 60;
const PAR_PHOTO_S = 15;
const duree = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`);
