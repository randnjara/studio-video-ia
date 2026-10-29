"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { lireCategorie } from "@/lib/categories";
import { FORMATS } from "@/lib/libelles";
import { propagerPremierePhoto } from "@/lib/photos";
import { requireProfile } from "@/lib/session";

// Étape 1 validée : les informations, le résumé, la voix off et le style sont enregistrés, puis on passe à ChatGPT
export async function enregistrerProjet(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const format = String(formData.get("aspect_ratio") ?? "9:16");
  const script = String(formData.get("scenario_text") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 50_000);
  const { data: avant } = await supabase.from("projects").select("scenario_text").eq("id", projectId).single();

  const infos = {
    title: String(formData.get("title") ?? "").trim() || "Sans titre",
    client_name: String(formData.get("client_name") ?? "").trim() || null,
    aspect_ratio: (FORMATS as readonly string[]).includes(format) ? format : "9:16",
    due_date: String(formData.get("due_date") ?? "") || null,
    workspace_id: String(formData.get("workspace_id") ?? ""),
    resume: String(formData.get("resume") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 5_000),
    style_text: String(formData.get("style_text") ?? "").trim().slice(0, 600),
    scenario_text: script,
  };
  const categorie = lireCategorie(formData.get("categorie"));
  let { error } = await supabase.from("projects").update({ ...infos, categorie }).eq("id", projectId);
  // Base sans la migration 0016 : les autres informations sont quand même enregistrées
  if (error && /categorie/.test(error.message))
    ({ error } = await supabase.from("projects").update(infos).eq("id", projectId));

  if (error) redirect(`/projets/${projectId}?erreur=enregistrement`);
  // Prise unique : chaque ligne doit avoir une photo de secours, celle de la première ligne
  await propagerPremierePhoto(supabase, projectId);
  // Une copie de la voix off dans l'historique, quand elle a changé
  if (script && script !== avant?.scenario_text?.trim())
    await supabase
      .from("project_versions")
      .insert({ project_id: projectId, kind: "scenario", data: { scenario_text: script }, created_by: profile.id });
  revalidatePath(`/projets/${projectId}`, "layout");
  revalidatePath("/");
  redirect(`/projets/${projectId}/chatgpt?infos=1`);
}

export async function mettreALaCorbeille(projectId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", projectId);
  await journaliser(supabase, profile.id, "corbeille", "projet", projectId);
  revalidatePath("/");
  redirect("/?supprime=1");
}
