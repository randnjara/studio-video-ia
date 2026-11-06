"use server";

import { lireCategorie } from "@/lib/categories";
import { journaliser } from "@/lib/journal";
import { type Transcription, promptPreparation, tableauARemplir } from "@/lib/preparation";
import { remplirParClaude } from "@/lib/remplissage-ia";
import { requireProfile } from "@/lib/session";

// « ✨ Remplir le tableau automatiquement » : la même consigne que le copier-coller (répliques audio comprises), envoyée à
// Claude ; le CSV rendu revient dans l'aperçu de l'import
export async function remplirTableauAuto(projectId: string) {
  const { supabase, profile } = await requireProfile();
  const [{ data: projet }, { data: refs }, { data: versions }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    supabase.from("film_refs").select("nom, genre, description").eq("project_id", projectId).order("created_at"),
    supabase
      .from("project_versions")
      .select("data")
      .eq("project_id", projectId)
      .eq("kind", "scenario")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (!projet) return { erreur: "Projet introuvable." };
  const transcription =
    ((versions ?? []).map((v) => (v.data as { transcription?: Transcription }).transcription).find((t) => t?.repliques?.length) as
      | Transcription
      | undefined) ?? null;
  const consigne = promptPreparation({
    titre: projet.title,
    format: projet.aspect_ratio,
    style: projet.style_text,
    script: projet.scenario_text,
    resume: projet.resume,
    categorie: lireCategorie(projet.categorie),
    refs: refs ?? [],
    transcription,
  });
  const r = await remplirParClaude(consigne, tableauARemplir(transcription));
  await journaliser(supabase, profile.id, "remplissage-ia", "projet", projectId, { ok: !("erreur" in r), audio: Boolean(transcription) });
  return r;
}
