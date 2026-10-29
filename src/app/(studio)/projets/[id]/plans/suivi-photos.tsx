"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EtatServeur } from "@/lib/surveillance";
import { EtatServeurVue, useJournalServeur } from "../etat-serveur";
import { actualiserPhotos } from "./actions";

// Tant que des photos de départ sont en création, demande des nouvelles au serveur toutes les 10 secondes,
// et montre l'état de la machine RunPod avec un petit historique.
export function SuiviPhotos({
  projectId,
  enCours,
  depuis,
  lot,
  enPause,
}: {
  projectId: string;
  enCours: number;
  // Heure de la demande du lot et nombre de photos demandées ensemble, pour que le compteur ne reparte pas de zéro
  depuis: string;
  lot: number;
  // En pause, la page continue de demander des nouvelles : les photos déjà en calcul se terminent et sont rangées
  enPause: boolean;
}) {
  const router = useRouter();
  const [secondes, setSecondes] = useState(0);
  const [serveur, setServeur] = useState<EtatServeur | null>(null);
  const { journal, noter } = useJournalServeur(`journal-photos:${projectId}:${depuis}`);
  const restantsVus = useRef(enCours);

  useEffect(() => {
    if (enCours === 0) return;
    let actif = true;
    const debut = depuis ? new Date(depuis).getTime() : Date.now();
    const compteur = setInterval(() => setSecondes(Math.round((Date.now() - debut) / 1000)), 1000);
    noter(enCours === 1 ? "1 photo demandée, envoi au serveur photo" : `${enCours} photos demandées, envoi au serveur photo`);
    const tour = async () => {
      const r = await actualiserPhotos(projectId).catch(() => null);
      if (!actif) return;
      if (!r) {
        noter("Le studio ne répond pas (connexion internet ?)", "alerte");
        return;
      }
      setServeur(r.serveur);
      if (r.serveur) noter(r.serveur.arret ?? r.serveur.texte, r.serveur.arret ? "alerte" : r.serveur.ton);
      const finies = restantsVus.current - r.restants;
      restantsVus.current = r.restants;
      if (finies > 0) noter(finies === 1 ? "1 photo terminée" : `${finies} photos terminées`);
      if (r.restants !== enCours || r.serveur?.arret) router.refresh();
    };
    tour();
    const boucle = setInterval(tour, 10_000);
    return () => {
      actif = false;
      clearInterval(compteur);
      clearInterval(boucle);
    };
  }, [projectId, enCours, depuis, router, noter]);

  if (enCours === 0) return null;
  // Mesuré sur le serveur photo : environ 1 min de démarrage, puis 10 à 15 s par photo
  const prevu = DEMARRAGE_S + PAR_PHOTO_S * Math.max(lot, enCours);
  const enRetard = !enPause && secondes > prevu * 2;
  if (enPause)
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-doux px-4 py-3 text-sm text-accent">
        <span aria-hidden>⏸</span>
        <span className="flex-1">
          En pause : {enCours === 1 ? "1 photo de départ pas encore terminée" : `${enCours} photos de départ pas encore terminées`}.
          Celles déjà en calcul se terminent et sont rangées dans leur plan.
        </span>
        <EtatServeurVue etat={serveur} journal={journal} />
      </div>
    );
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm ${enRetard ? "bg-alerte-doux text-alerte" : "bg-accent-doux text-accent"}`}
    >
      <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="flex-1">
        {enCours === 1 ? "1 photo de départ en création" : `${enCours} photos de départ en création`} : {duree(secondes)}{" "}
        sur environ {duree(prevu)} prévues. Gardez cette page ouverte.
        {enRetard &&
          " C'est beaucoup plus long que prévu : regardez l'état de la machine ci-dessous. Si rien n'aboutit, le studio coupe le serveur tout seul pour ne pas payer pour rien."}
      </span>
      <EtatServeurVue etat={serveur} journal={journal} />
    </div>
  );
}

const DEMARRAGE_S = 60;
const PAR_PHOTO_S = 15;
const duree = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`);
