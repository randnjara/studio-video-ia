"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { FORMATS } from "@/lib/libelles";
import { requireProfile } from "@/lib/session";

export async function creerProjet(formData: FormData) {
  const { supabase, profile } = await requireProfile();

  const title = String(formData.get("title") ?? "").trim();
  const workspaceId = String(formData.get("workspace_id") ?? "");
  const format = String(formData.get("aspect_ratio") ?? "9:16");
  if (!title || !workspaceId) redirect("/?erreur=projet-incomplet");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      title,
      workspace_id: workspaceId,
      client_name: String(formData.get("client_name") ?? "").trim() || null,
      aspect_ratio: (FORMATS as readonly string[]).includes(format) ? format : "9:16",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !data) redirect("/?erreur=projet-refuse");

  await journaliser(supabase, profile.id, "creation", "projet", data.id, { title });
  revalidatePath("/");
  redirect(`/projets/${data.id}`);
}

export async function supprimerProjet(projectId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase.from("projects").update({ deleted_at: new Date().toISOString() }).eq("id", projectId);
  await journaliser(supabase, profile.id, "corbeille", "projet", projectId);
  revalidatePath("/");
  redirect("/?supprime=1");
}

export async function restaurerProjet(projectId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase.from("projects").update({ deleted_at: null }).eq("id", projectId);
  await journaliser(supabase, profile.id, "restauration", "projet", projectId);
  revalidatePath("/");
  redirect("/?corbeille=1");
}
