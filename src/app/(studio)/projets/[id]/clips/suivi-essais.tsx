"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { EtatServeur } from "@/lib/surveillance";
import { EtatServeurVue, useJournalServeur } from "../etat-serveur";
import { actualiserEssais } from "./actions";

// Tant qu'un essai tourne, demande des nouvelles à RunPod toutes les 10 secondes et rafraîchit la page.
// Prévient avec une notification du navigateur quand une vidéo est prête.
// En pause, la page continue de demander des nouvelles : les vidéos déjà en calcul se terminent et sont rangées.
export function SuiviEssais({ projectId, enCours, enPause }: { projectId: string; enCours: number; enPause: boolean }) {
  const router = useRouter();
  const [secondes, setSecondes] = useState(0);
  const [permission, setPermission] = useState<NotificationPermission | "absent">("absent");
  const precedent = useRef(enCours);
  const [serveur, setServeur] = useState<EtatServeur | null>(null);
  const { journal, noter } = useJournalServeur(`journal-videos:${projectId}`);

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "absent");
  }, []);

  // Une ou plusieurs vidéos viennent de finir
  useEffect(() => {
    const finies = precedent.current - enCours;
    precedent.current = enCours;
    if (finies <= 0) return;
    const texte = finies === 1 ? "Une vidéo est prête à valider." : `${finies} vidéos sont prêtes à valider.`;
    noter(texte);
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Studio Vidéo IA", { body: texte });
      }
    } catch {}
  }, [enCours, noter]);

  useEffect(() => {
    if (enCours === 0) return;
    let actif = true;
    const debut = Date.now();
    const compteur = setInterval(() => setSecondes(Math.round((Date.now() - debut) / 1000)), 1000);
    noter(enCours === 1 ? "1 vidéo en cours" : `${enCours} vidéos en cours`);
    const tour = async () => {
      const r = await actualiserEssais(projectId).catch(() => null);
      if (!actif) return;
      if (!r) {
        noter("Le studio ne répond pas (connexion internet ?)", "alerte");
        return;
      }
      setServeur(r.serveur);
      if (r.serveur) noter(r.serveur.arret ?? r.serveur.texte, r.serveur.arret ? "alerte" : r.serveur.ton);
      if (r.restants !== enCours || r.serveur?.arret) router.refresh();
    };
    tour();
    const boucle = setInterval(tour, 10_000);
    return () => {
      actif = false;
      clearInterval(compteur);
      clearInterval(boucle);
    };
  }, [projectId, enCours, router, noter]);

  if (enCours === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent-doux px-4 py-3 text-sm text-accent">
      {enPause ? (
        <span aria-hidden>⏸</span>
      ) : (
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      <span className="flex-1">
        {enPause ? (
          `En pause : ${enCours === 1 ? "1 vidéo pas encore terminée" : `${enCours} vidéos pas encore terminées`}. Celles déjà en calcul se terminent et sont rangées ici.`
        ) : (
          <>
            {enCours === 1 ? "1 vidéo en cours de génération" : `${enCours} vidéos en cours de génération`} ({secondes} s). Comptez
            1 à 4 minutes par plan. Gardez cette page ouverte (ou revenez-y dans les 20 minutes) pour que la vidéo soit rangée
            dans le projet.
          </>
        )}
      </span>
      {permission === "default" && (
        <button
          type="button"
          className="bouton-discret px-3 py-1"
          onClick={() => Notification.requestPermission().then(setPermission)}
        >
          🔔 Me prévenir quand c'est prêt
        </button>
      )}
      <EtatServeurVue etat={serveur} journal={journal} />
    </div>
  );
}
