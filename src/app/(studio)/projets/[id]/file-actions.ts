"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CLE_ARRET_SERVEUR, VALEUR_PAUSE, clePause, lireArretServeur, lireEtatFile, valeurReprise } from "@/lib/file-attente";
import { journaliser } from "@/lib/journal";
import { arreterPhotos } from "@/lib/photos";
import { arreterEssais } from "@/lib/production";
import { arreterServeurs, redemarrerServeurs } from "@/lib/runpod-admin";
import { requireProfile } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

// Boutons du bandeau de génération (onglets Plans et Clips) : pause, reprise, arrêt du lot et du serveur RunPod.
export type Onglet = "plans" | "clips";

function retour(projectId: string, onglet: Onglet, params: string): never {
  revalidatePath(`/projets/${projectId}`, "layout");
  redirect(`/projets/${projectId}/${onglet === "plans" ? "plans" : "clips"}?${params}`);
}

// La pause est rangée dans les réglages (modifiables par le responsable seul) : on vérifie d'abord que la personne
// a accès au projet, puis on l'écrit avec la clé secrète
async function ecrirePause(projectId: string, valeur: string) {
  const { supabase, profile } = await requireProfile();
  const { data: projet } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!projet) redirect("/");
  await createAdminClient()
    .from("reglages")
    .upsert({ cle: clePause(projectId), valeur, updated_at: new Date().toISOString() });
  return { supabase, profile };
}

export async function mettreEnPause(projectId: string, onglet: Onglet) {
  const { supabase, profile } = await ecrirePause(projectId, VALEUR_PAUSE);
  await journaliser(supabase, profile.id, "pause", "projet", projectId);
  retour(projectId, onglet, "file=pause");
}

export async function reprendre(projectId: string, onglet: Onglet) {
  const { supabase, profile } = await ecrirePause(projectId, valeurReprise());
  await journaliser(supabase, profile.id, "reprise", "projet", projectId);
  retour(projectId, onglet, "file=reprise");
}

// Annule tout ce qui n'est pas terminé (photos et vidéos du projet). La pause est levée pour le prochain lot.
export async function arreterLot(projectId: string, onglet: Onglet) {
  const { supabase, profile } = await requireProfile();
  const [videos, photos] = await Promise.all([arreterEssais(supabase, projectId), arreterPhotos(supabase, projectId)]);
  const restants = videos.restants + photos.restants;
  if (restants === 0) await ecrirePause(projectId, valeurReprise());
  await journaliser(supabase, profile.id, "arret-lot", "projet", projectId, {
    videos: videos.arretes,
    photos: photos.arretes,
  });
  retour(projectId, onglet, `file=arret&arretes=${videos.arretes + photos.arretes}&restants=${restants}`);
}

// Les boutons du serveur sont aussi dans « Équipe et budget » : on revient sur la page d'où vient le clic
function retourServeur(chemin: string, params: string): never {
  revalidatePath("/", "layout");
  redirect(`${/^\/(projets\/[\w-]+\/(plans|clips)|equipe)$/.test(chemin) ? chemin : "/equipe"}?${params}`);
}

async function requireResponsable() {
  const ctx = await requireProfile();
  if (ctx.profile.role !== "responsable") redirect("/");
  return ctx;
}

// Coupe nos serveurs RunPod pour toute l'équipe : plus aucune machine ne s'allume, plus rien n'est facturé.
// Les photos et vidéos en attente restent dans la file et repartiront au redémarrage.
export async function arreterServeur(chemin: string) {
  const { supabase, profile } = await requireResponsable();
  const etat = await lireEtatFile(supabase, "");
  const ids = [...new Set([etat.serveurVideo, etat.serveurPhoto].filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) retourServeur(chemin, "file=sans-serveur");

  // Calculs en cours chez RunPod, tous projets confondus (clé secrète : le responsable ne voit pas tous les espaces)
  const admin = createAdminClient();
  const [{ data: essais }, { data: photos }] = await Promise.all([
    admin.from("takes").select("runpod_job_id").eq("status", "en_cours").neq("moteur", "qualite").not("runpod_job_id", "is", null).neq("runpod_job_id", "envoi").limit(20),
    admin.from("photos").select("runpod_job_id").eq("status", "en_cours").not("runpod_job_id", "is", null).neq("runpod_job_id", "envoi").limit(20),
  ]);
  const jobs = [
    ...(etat.serveurVideo ? (essais ?? []).map((e) => ({ serveur: etat.serveurVideo!, jobId: String(e.runpod_job_id) })) : []),
    ...(etat.serveurPhoto ? (photos ?? []).map((p) => ({ serveur: etat.serveurPhoto!, jobId: String(p.runpod_job_id) })) : []),
  ];

  let max: Record<string, number>;
  try {
    max = await arreterServeurs(ids, jobs);
  } catch (e) {
    retourServeur(chemin, `file=serveur-erreur&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  await supabase.from("reglages").upsert({
    cle: CLE_ARRET_SERVEUR,
    valeur: JSON.stringify({ arrete: true, depuis: new Date().toISOString(), max }),
    updated_at: new Date().toISOString(),
  });
  await journaliser(supabase, profile.id, "arret-serveur", "reglage", null, { serveurs: ids });
  retourServeur(chemin, "file=serveur-arrete");
}

export async function redemarrerServeur(chemin: string) {
  const { supabase, profile } = await requireResponsable();
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", CLE_ARRET_SERVEUR).maybeSingle();
  const arret = lireArretServeur(data?.valeur);
  try {
    await redemarrerServeurs(arret?.max ?? {});
  } catch (e) {
    retourServeur(chemin, `file=serveur-erreur&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  await supabase.from("reglages").upsert({
    cle: CLE_ARRET_SERVEUR,
    valeur: JSON.stringify({ arrete: false, depuis: new Date().toISOString(), max: arret?.max ?? {} }),
    updated_at: new Date().toISOString(),
  });
  await journaliser(supabase, profile.id, "redemarrage-serveur", "reglage", null);
  retourServeur(chemin, "file=serveur-redemarre");
}
