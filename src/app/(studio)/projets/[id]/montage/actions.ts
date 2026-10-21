"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
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

async function lireMontage(supabase: Supabase, projectId: string, montageId: string) {
  const { data } = await supabase
    .from("montages")
    .select("id, take_ids, status")
    .eq("id", montageId)
    .eq("project_id", projectId)
    .single();
  return data as { id: string; take_ids: string[]; status: string } | null;
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

export async function deplacerClip(projectId: string, montageId: string, index: number, sens: -1 | 1) {
  const { supabase } = await requireProfile();
  const m = await lireMontage(supabase, projectId, montageId);
  if (m && m.take_ids[index + sens]) {
    const ids = [...m.take_ids];
    [ids[index], ids[index + sens]] = [ids[index + sens], ids[index]];
    await supabase.from("montages").update({ take_ids: ids }).eq("id", montageId);
  }
  await retour(supabase, projectId, `#montage-${montageId}`);
}

export async function retirerClip(projectId: string, montageId: string, index: number) {
  const { supabase } = await requireProfile();
  const m = await lireMontage(supabase, projectId, montageId);
  if (m) await supabase.from("montages").update({ take_ids: m.take_ids.filter((_, i) => i !== index) }).eq("id", montageId);
  await retour(supabase, projectId, `#montage-${montageId}`);
}

export async function ajouterClip(projectId: string, montageId: string, formData: FormData) {
  const { supabase } = await requireProfile();
  const takeId = String(formData.get("clip") ?? "");
  const [m, { data: plan }] = await Promise.all([
    lireMontage(supabase, projectId, montageId),
    supabase.from("scenes").select("id").eq("project_id", projectId).eq("validated_take_id", takeId).maybeSingle(),
  ]);
  if (m && plan) await supabase.from("montages").update({ take_ids: [...m.take_ids, takeId] }).eq("id", montageId);
  await retour(supabase, projectId, `#montage-${montageId}`);
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
