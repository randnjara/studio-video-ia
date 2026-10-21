"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { FORMATS } from "@/lib/libelles";
import { requireProfile } from "@/lib/session";

export async function enregistrerProjet(projectId: string, formData: FormData) {
  const { supabase } = await requireProfile();
  const format = String(formData.get("aspect_ratio") ?? "9:16");

  const { error } = await supabase
    .from("projects")
    .update({
      title: String(formData.get("title") ?? "").trim() || "Sans titre",
      client_name: String(formData.get("client_name") ?? "").trim() || null,
      aspect_ratio: (FORMATS as readonly string[]).includes(format) ? format : "9:16",
      due_date: String(formData.get("due_date") ?? "") || null,
      workspace_id: String(formData.get("workspace_id") ?? ""),
    })
    .eq("id", projectId);

  if (error) redirect(`/projets/${projectId}?erreur=enregistrement`);
  revalidatePath(`/projets/${projectId}`, "layout");
  revalidatePath("/");
  redirect(`/projets/${projectId}?enregistre=1`);
}

export async function mettreALaCorbeille(projectId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", projectId);
  await journaliser(supabase, profile.id, "corbeille", "projet", projectId);
  revalidatePath("/");
  redirect("/?supprime=1");
}
