"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { FORMATS } from "@/lib/libelles";
import { requireProfile } from "@/lib/session";

export async function enregistrerProjet(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const format = String(formData.get("aspect_ratio") ?? "9:16");
  const scenario = String(formData.get("scenario_text") ?? "");

  const { data: avant } = await supabase
    .from("projects")
    .select("scenario_text")
    .eq("id", projectId)
    .single();

  const { error } = await supabase
    .from("projects")
    .update({
      title: String(formData.get("title") ?? "").trim() || "Sans titre",
      client_name: String(formData.get("client_name") ?? "").trim() || null,
      aspect_ratio: (FORMATS as readonly string[]).includes(format) ? format : "9:16",
      due_date: String(formData.get("due_date") ?? "") || null,
      workspace_id: String(formData.get("workspace_id") ?? ""),
      scenario_text: scenario,
    })
    .eq("id", projectId);

  if (error) redirect(`/projets/${projectId}?erreur=enregistrement`);

  // Historique : une version du scénario est gardée à chaque changement
  if (avant && avant.scenario_text !== scenario) {
    await supabase.from("project_versions").insert({
      project_id: projectId,
      kind: "scenario",
      data: { scenario_text: scenario },
      created_by: profile.id,
    });
  }

  revalidatePath(`/projets/${projectId}`);
  revalidatePath("/");
  redirect(`/projets/${projectId}?enregistre=1`);
}

export async function restaurerScenario(projectId: string, versionId: number) {
  const { supabase, profile } = await requireProfile();
  const { data: version } = await supabase
    .from("project_versions")
    .select("data")
    .eq("id", versionId)
    .eq("project_id", projectId)
    .single();
  if (!version) redirect(`/projets/${projectId}?erreur=version`);

  const texte = String((version.data as { scenario_text?: string }).scenario_text ?? "");
  await supabase.from("projects").update({ scenario_text: texte }).eq("id", projectId);
  await supabase.from("project_versions").insert({
    project_id: projectId,
    kind: "scenario",
    data: { scenario_text: texte, restaure_depuis: versionId },
    created_by: profile.id,
  });
  revalidatePath(`/projets/${projectId}`);
  redirect(`/projets/${projectId}?restaure=1`);
}

export async function mettreALaCorbeille(projectId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", projectId);
  await journaliser(supabase, profile.id, "corbeille", "projet", projectId);
  revalidatePath("/");
  redirect("/?corbeille=1");
}
