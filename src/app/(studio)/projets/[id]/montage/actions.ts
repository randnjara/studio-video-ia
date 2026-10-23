"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { lireTimeline } from "@/lib/montage";
import { majStatutProjet } from "@/lib/production";
import { requireProfile } from "@/lib/session";

type Supabase = Awaited<ReturnType<typeof requireProfile>>["supabase"];

// statut : le montage a été créé, supprimé ou a changé d'état, donc le statut du projet peut changer
async function retour(supabase: Supabase, projectId: string, params = "", statut = false): Promise<never> {
  if (statut) await majStatutProjet(supabase, projectId);
  revalidatePath(`/projets/${projectId}`, "layout");
  revalidatePath("/");
  redirect(`/projets/${projectId}/montage${params}`);
}

// Un montage = des clips validés mis bout à bout, dans l'ordre choisi
export async function creerMontage(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const clips = formData.getAll("clips").map(String);
  if (clips.length === 0) redirect(`/projets/${projectId}/montage?erreur=vide`);

  // Seuls les clips validés de ce projet sont acceptés, dans l'ordre des plans
  const { data: plans } = await supabase
    .from("scenes")
    .select("validated_take_id")
    .eq("project_id", projectId)
    .not("validated_take_id", "is", null)
    .order("position");
  const permis = (plans ?? []).map((p) => p.validated_take_id as string);
  const take_ids = permis.filter((t) => clips.includes(t));

  const { data: montage, error } = await supabase
    .from("montages")
    .insert({
      project_id: projectId,
      title: String(formData.get("title") ?? "").trim() || "Montage",
      take_ids,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !montage) redirect(`/projets/${projectId}/montage?erreur=creation`);
  await journaliser(supabase, profile.id, "creation", "montage", montage.id, { project_id: projectId });
  await retour(supabase, projectId, `?cree=1#montage-${montage.id}`, true);
}

// Enregistrement automatique de l'éditeur : la timeline entière, et les clips de la piste principale dans take_ids
export async function enregistrerTimeline(projectId: string, montageId: string, brut: unknown) {
  const { supabase } = await requireProfile();
  const timeline = lireTimeline(brut);
  if (!timeline) return { erreur: "Montage illisible." };
  const take_ids = timeline.pistes[0].elements.flatMap((e) => (e.takeId ? [e.takeId] : []));
  const { error } = await supabase
    .from("montages")
    .update({ timeline, take_ids })
    .eq("id", montageId)
    .eq("project_id", projectId)
    .in("status", ["brouillon", "a_corriger"]);
  if (error) {
    return {
      erreur: error.message.includes("timeline")
        ? "La base n'est pas encore à jour (migration 0012 à appliquer)."
        : `Enregistrement impossible : ${error.message}`,
    };
  }
  return { erreur: null };
}

export async function renommerMontage(projectId: string, montageId: string, formData: FormData) {
  const { supabase } = await requireProfile();
  const title = String(formData.get("title") ?? "").trim();
  if (title) await supabase.from("montages").update({ title }).eq("id", montageId).eq("project_id", projectId);
  await retour(supabase, projectId, `#montage-${montageId}`);
}

// brouillon → à valider → validé, ou à corriger (avec un commentaire) puis de nouveau à valider
export async function changerStatutMontage(
  projectId: string,
  montageId: string,
  statut: "brouillon" | "a_valider" | "valide" | "a_corriger",
  formData?: FormData,
) {
  const { supabase, profile } = await requireProfile();
  const commentaire = String(formData?.get("comment") ?? "").trim();
  await Promise.all([
    supabase
      .from("montages")
      .update({
        status: statut,
        ...(statut === "a_corriger" ? { comment: commentaire || null } : statut === "valide" ? { comment: null } : {}),
      })
      .eq("id", montageId)
      .eq("project_id", projectId),
    journaliser(supabase, profile.id, `montage-${statut}`, "montage", montageId, { project_id: projectId }),
  ]);
  await retour(supabase, projectId, `?statut=${statut}#montage-${montageId}`, true);
}

export async function supprimerMontage(projectId: string, montageId: string) {
  const { supabase, profile } = await requireProfile();
  await Promise.all([
    supabase.from("montages").delete().eq("id", montageId).eq("project_id", projectId),
    journaliser(supabase, profile.id, "suppression", "montage", montageId, { project_id: projectId }),
  ]);
  await retour(supabase, projectId, "?supprime=1", true);
}
