"use server";

import { revalidatePath } from "next/cache";
import { journaliser } from "@/lib/journal";
import { requireProfile } from "@/lib/session";
import { lireReglages } from "@/lib/voix";
import { lancerCreation, suivreCreations } from "@/lib/voix-serveur";

const page = (projectId: string) => `/projets/${projectId}/voix`;
const cheminDuProjet = (projectId: string, chemin: string) =>
  chemin.startsWith(`${projectId}/voix/`) && !chemin.includes("..");

// Texte → voix avec la voix choisie
export async function creerVoix(projectId: string, p: { voixId: string; texte: string; emotion: number; nom: string }) {
  const { supabase, profile } = await requireProfile();
  const texte = p.texte.trim().slice(0, 5000);
  if (!texte) return { erreur: "Écrivez d'abord le texte à dire." };
  const r = await lancerCreation(supabase, profile.id, projectId, {
    voixId: p.voixId,
    texte,
    emotion: Math.min(Math.max(Number(p.emotion) || 0.5, 0.25), 2),
    nom: p.nom.trim().slice(0, 120),
  });
  if (!r.erreur) await journaliser(supabase, profile.id, "creation-voix", "projet", projectId);
  revalidatePath(page(projectId));
  return r;
}

// Enregistrement importé (déjà dans le stockage) : gardé tel quel pour la table de mixage,
// ou transformé avec la voix d'une personne par le serveur voix
export async function importerEnregistrement(
  projectId: string,
  p: { chemin: string; nom: string; duree: number | null; voixId: string | null },
) {
  const { supabase, profile } = await requireProfile();
  if (!cheminDuProjet(projectId, p.chemin)) return { erreur: "Fichier refusé." };
  const nom = p.nom.trim().slice(0, 120) || "Enregistrement";
  if (p.voixId) {
    const r = await lancerCreation(supabase, profile.id, projectId, { voixId: p.voixId, texte: "", emotion: 0.5, nom, sourcePath: p.chemin });
    revalidatePath(page(projectId));
    return r;
  }
  const { error } = await supabase.from("voix_creations").insert({
    project_id: projectId,
    nom,
    status: "terminee",
    source_path: p.chemin,
    audio_path: p.chemin,
    duree_s: p.duree,
    cost_usd: 0,
    created_by: profile.id,
    finished_at: new Date().toISOString(),
  });
  revalidatePath(page(projectId));
  return { erreur: error ? `Import impossible : ${error.message}` : null };
}

// Appelé toutes les quelques secondes par la page tant qu'une voix est en calcul
export async function actualiserVoix(projectId: string) {
  const { supabase } = await requireProfile();
  return suivreCreations(supabase, projectId);
}

// Version passée par la table de mixage : proposée au montage à la place de la voix brute
export async function enregistrerMixage(
  projectId: string,
  creationId: string,
  p: { chemin: string; reglages: unknown; duree: number },
) {
  const { supabase } = await requireProfile();
  if (!cheminDuProjet(projectId, p.chemin)) return { erreur: "Fichier refusé." };
  const { error } = await supabase
    .from("voix_creations")
    .update({ mixage_path: p.chemin, reglages: lireReglages(p.reglages), duree_s: Math.round(p.duree * 100) / 100 })
    .eq("id", creationId)
    .eq("project_id", projectId);
  if (error) return { erreur: `Enregistrement impossible : ${error.message}` };
  // L'ancien mixage reste dans le stockage : un montage l'utilise peut-être encore
  revalidatePath(page(projectId));
  revalidatePath(`/projets/${projectId}/montage`);
  return { erreur: null };
}

export async function renommerCreation(projectId: string, creationId: string, nom: string) {
  const { supabase } = await requireProfile();
  const propre = nom.trim().slice(0, 120);
  if (propre) await supabase.from("voix_creations").update({ nom: propre }).eq("id", creationId).eq("project_id", projectId);
  revalidatePath(page(projectId));
}

export async function supprimerCreation(projectId: string, creationId: string) {
  const { supabase, profile } = await requireProfile();
  const { data } = await supabase
    .from("voix_creations")
    .select("audio_path, mixage_path, source_path")
    .eq("id", creationId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) return;
  await supabase.from("voix_creations").delete().eq("id", creationId).eq("project_id", projectId);
  const fichiers = [...new Set([data.audio_path, data.mixage_path, data.source_path])].filter(
    (c): c is string => Boolean(c) && cheminDuProjet(projectId, c as string),
  );
  if (fichiers.length) await supabase.storage.from("medias").remove(fichiers);
  await journaliser(supabase, profile.id, "suppression-voix", "projet", projectId);
  revalidatePath(page(projectId));
}
