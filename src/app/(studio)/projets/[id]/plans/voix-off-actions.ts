"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { finirCalage, finirTranscription, lancerWhisper, restaurerTableau } from "@/lib/calage-serveur";
import { journaliser } from "@/lib/journal";
import { requireProfile } from "@/lib/session";
import { finirLotDecoupage, lancerLotDecoupage } from "@/lib/voix-off";
import { nomDuFichier, texteVoixOff } from "@/lib/voix-off-import";

// Découpe de la voix off en un morceau par plan (lip-sync). Le navigateur enchaîne les lots : lancer, suivre, lancer…
export async function lancerDecoupage(projectId: string, creationId: string, recaler: boolean, depuis: number) {
  const { supabase, profile } = await requireProfile();
  const r = await lancerLotDecoupage(supabase, projectId, { creationId, recaler, depuis: Math.max(0, Math.floor(depuis)) });
  if (!("erreur" in r) && depuis === 0)
    await journaliser(supabase, profile.id, "decoupage-voix", "projet", projectId, { voix_creation_id: creationId, recaler });
  return r;
}

export async function suivreDecoupage(projectId: string, creationId: string, jobId: string) {
  const { supabase } = await requireProfile();
  const r = await finirLotDecoupage(supabase, projectId, { creationId, jobId });
  if ("etat" in r && r.etat === "terminee") revalidatePath(`/projets/${projectId}`, "layout");
  return r;
}

// Voix off audio déjà finie, envoyée par le navigateur dans le stockage du projet : rangée comme une voix terminée
// (sans calcul RunPod ni coût), avec pour texte les répliques des plans. Elle se découpe et va au montage comme les autres.
export async function enregistrerVoixImportee(projectId: string, p: { chemin: string; nom: string; duree: number }) {
  const { supabase, profile } = await requireProfile();
  if (!p.chemin.startsWith(`${projectId}/voix/`) || p.chemin.includes("..")) return { erreur: "Fichier refusé." };
  const duree = Number(p.duree);
  if (!Number.isFinite(duree) || duree <= 0.2 || duree > 4 * 3600) return { erreur: "Durée de l'audio illisible." };
  const { data: plans } = await supabase.from("scenes").select("voiceover_text").eq("project_id", projectId).order("position");
  const ligne = {
    project_id: projectId,
    nom: nomDuFichier(p.nom),
    texte: texteVoixOff((plans ?? []).map((s) => s.voiceover_text)),
    status: "terminee",
    audio_path: p.chemin,
    duree_s: Math.round(duree * 100) / 100,
    cost_usd: 0,
    created_by: profile.id,
    finished_at: new Date().toISOString(),
  };
  // RLS : voix_creations n'accepte que les projets accessibles (can_access_project). Sans la migration 0019, la colonne
  // « source » manque : la voix est enregistrée sans elle.
  let { data, error } = await supabase.from("voix_creations").insert({ ...ligne, source: "importee" }).select("id").single();
  if (error && /source/.test(error.message)) ({ data, error } = await supabase.from("voix_creations").insert(ligne).select("id").single());
  if (error || !data) {
    await supabase.storage.from("medias").remove([p.chemin]);
    return { erreur: `Import impossible : ${error?.message ?? "inconnu"}` };
  }
  await journaliser(supabase, profile.id, "import-voix-off", "projet", projectId, { voix_creation_id: data.id, duree });
  revalidatePath(`/projets/${projectId}`, "layout");
  return { id: data.id as string };
}

// Calage des plans sur la voix off audio (lancé tout seul dès qu'une voix off est importée ou choisie)
export async function lancerCalage(projectId: string, creationId: string, langue?: string) {
  const { supabase, profile } = await requireProfile();
  const r = await lancerWhisper(supabase, projectId, creationId, "aligner", langue);
  if (!("erreur" in r)) await journaliser(supabase, profile.id, "calage-voix", "projet", projectId, { voix_creation_id: creationId });
  return r;
}

export async function suivreCalage(projectId: string, creationId: string, jobId: string) {
  const { supabase, profile } = await requireProfile();
  const r = await finirCalage(supabase, profile.id, projectId, creationId, jobId);
  if ("etat" in r && r.etat === "terminee") revalidatePath(`/projets/${projectId}`, "layout");
  return r;
}

// Revenir au tableau d'avant un calage (version gardée dans project_versions)
export async function revenirAuTableau(projectId: string, versionId: number) {
  const { supabase, profile } = await requireProfile();
  const r = await restaurerTableau(supabase, projectId, versionId);
  if (!r.erreur) await journaliser(supabase, profile.id, "restauration-tableau", "projet", projectId, { version: versionId });
  revalidatePath(`/projets/${projectId}`, "layout");
  redirect(`/projets/${projectId}/plans${r.erreur ? "?erreur=restauration" : "?tableau-restaure=1"}`);
}

// « Préparer le tableau depuis l'audio » : transcription horodatée en répliques de 5 s au plus, avec le ton
export async function lancerTranscription(projectId: string, creationId: string, langue?: string) {
  const { supabase } = await requireProfile();
  return lancerWhisper(supabase, projectId, creationId, "transcrire", langue);
}

export async function suivreTranscription(projectId: string, creationId: string, jobId: string) {
  const { supabase, profile } = await requireProfile();
  const r = await finirTranscription(supabase, profile.id, projectId, creationId, jobId);
  if ("etat" in r && r.etat === "terminee") revalidatePath(`/projets/${projectId}`, "layout");
  return r;
}
