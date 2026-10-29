import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLE_ARRET_SERVEUR, type EtatFile, attente, lireArretServeur } from "@/lib/file-attente";
import { cle } from "@/lib/runpod";
import { arreterServeurs } from "@/lib/runpod-admin";
import { createAdminClient } from "@/lib/supabase/admin";

// Surveillance de nos serveurs RunPod pendant une génération : état de la machine, affiché sous la barre de progression,
// et arrêt automatique quand plus rien n'avance, pour ne pas payer une machine qui tourne dans le vide.

// Sans aucun résultat pendant ce temps, le studio coupe le serveur. Mesuré : photo ≈ 1 min de démarrage puis 15 s,
// vidéo 1 à 4 min par plan après un démarrage de quelques minutes.
export const INACTIVITE_MAX_MS = { photo: 12 * 60 * 1000, video: 25 * 60 * 1000 };

// Réponse de RunPod à /health : machines par état et travaux dans sa file
type Sante = {
  jobs: { inQueue: number; inProgress: number };
  workers: { idle: number; initializing: number; ready: number; running: number; throttled: number; unhealthy: number };
};

export type EtatServeur = {
  // Phrase courte pour la personne, et sa couleur
  texte: string;
  ton: "ok" | "attente" | "alerte";
  // Temps sans aucun résultat, et seuil d'arrêt automatique (en secondes)
  inactifS: number;
  limiteS: number;
  // Rempli quand le studio vient de couper le serveur
  arret?: string;
};

async function lireSante(serveur: string): Promise<Sante | null> {
  try {
    const res = await fetch(`https://api.runpod.ai/v2/${encodeURIComponent(serveur)}/health`, {
      headers: { Authorization: `Bearer ${cle()}` },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<Sante>;
    const n = (v: unknown) => Number(v) || 0;
    return {
      jobs: { inQueue: n(d.jobs?.inQueue), inProgress: n(d.jobs?.inProgress) },
      workers: {
        idle: n(d.workers?.idle),
        initializing: n(d.workers?.initializing),
        ready: n(d.workers?.ready),
        running: n(d.workers?.running),
        throttled: n(d.workers?.throttled),
        unhealthy: n(d.workers?.unhealthy),
      },
    };
  } catch {
    return null;
  }
}

function decrire(s: Sante | null): Pick<EtatServeur, "texte" | "ton"> {
  if (!s) return { texte: "RunPod ne répond pas pour l'instant.", ton: "alerte" };
  const w = s.workers;
  const file = s.jobs.inQueue > 0 ? `, ${s.jobs.inQueue} en file chez RunPod` : "";
  if (w.unhealthy > 0) return { texte: `Machine en erreur chez RunPod${file}.`, ton: "alerte" };
  if (w.running > 0) return { texte: `Machine en calcul (${s.jobs.inProgress} en cours${file}).`, ton: "ok" };
  if (w.initializing > 0) return { texte: `Machine en démarrage (chargement du modèle, facturé)${file}.`, ton: "attente" };
  if (w.idle + w.ready > 0) return { texte: `Machine allumée, prête${file}.`, ton: "ok" };
  if (w.throttled > 0) return { texte: `Aucune carte graphique libre chez RunPod pour l'instant (non facturé)${file}.`, ton: "attente" };
  if (s.jobs.inQueue > 0) return { texte: `En file chez RunPod, aucune machine allumée (non facturé)${file}.`, ton: "attente" };
  return { texte: "Connecté à RunPod, aucune machine allumée.", ton: "ok" };
}

// Coupe un serveur comme le bouton « Arrêter le serveur » (0 machine), en gardant la raison pour la page.
// Les travaux envoyés sont annulés et sa file vidée : plus rien n'est facturé.
async function arreterAuto(serveur: string, jobs: string[], raison: string) {
  const admin = createAdminClient();
  const { data } = await admin.from("reglages").select("valeur").eq("cle", CLE_ARRET_SERVEUR).maybeSingle();
  const avant = lireArretServeur(data?.valeur);
  if (avant?.arrete) return;
  const max = await arreterServeurs(
    [serveur],
    jobs.map((jobId) => ({ serveur, jobId })),
  );
  await admin.from("reglages").upsert({
    cle: CLE_ARRET_SERVEUR,
    valeur: JSON.stringify({ arrete: true, depuis: new Date().toISOString(), max, auto: raison }),
    updated_at: new Date().toISOString(),
  });
}

// Lit l'état du serveur et le coupe si rien n'a abouti depuis trop longtemps. Les travaux annulés reviennent dans
// la file au tour suivant (comme pour « Arrêter le serveur ») et repartiront au redémarrage.
export async function surveiller(
  supabase: SupabaseClient,
  projectId: string,
  sorte: "photo" | "video",
  serveur: string | null,
  etat: EtatFile,
  parties: { runpod_job_id: string; created_at: string }[],
): Promise<EtatServeur | null> {
  if (!serveur) return null;
  const limite = INACTIVITE_MAX_MS[sorte];
  const table = sorte === "photo" ? "photos" : "takes";
  const lien = sorte === "photo" ? "scenes!inner(project_id)" : "scenes!takes_scene_id_fkey!inner(project_id)";
  const [sante, { data: derniere }] = await Promise.all([
    lireSante(serveur),
    // Dernier résultat du projet, réussi ou non : tant qu'il en arrive, le serveur travaille
    supabase
      .from(table)
      .select(`finished_at, ${lien}`)
      .eq("scenes.project_id", projectId)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const vu = decrire(sante);
  // Sans travail envoyé chez RunPod, rien ne peut tourner pour nous
  if (parties.length === 0 || etat.enPause || etat.serveurArrete)
    return { ...vu, inactifS: 0, limiteS: Math.round(limite / 1000) };

  // Inactif depuis le plus récent de : premier envoi du lot encore en cours, dernier résultat, dernière reprise
  const premier = Math.min(...parties.map((p) => Date.now() - attente(etat, p.created_at)));
  const fin = (derniere as { finished_at?: string } | null)?.finished_at;
  const inactif = Date.now() - Math.max(premier, fin ? new Date(fin).getTime() : 0);
  const base = { ...vu, inactifS: Math.round(inactif / 1000), limiteS: Math.round(limite / 1000) };
  if (inactif <= limite) return base;

  const minutes = Math.round(limite / 60000);
  const raison = `${sorte === "photo" ? "Serveur photo" : "Serveur vidéo"} coupé automatiquement : aucun résultat en ${minutes} min (${vu.texte.replace(/\.$/, "").toLowerCase()}).`;
  try {
    await arreterAuto(
      serveur,
      parties.map((p) => p.runpod_job_id),
      raison,
    );
  } catch {
    return { ...base, texte: `${vu.texte} L'arrêt automatique a échoué : arrêtez le serveur à la main.`, ton: "alerte" };
  }
  return { ...base, ton: "alerte", arret: raison };
}
