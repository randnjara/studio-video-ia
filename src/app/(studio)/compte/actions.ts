"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { FORMAT_NOM_UTILISATEUR, LONGUEUR_MOT_DE_PASSE } from "@/lib/identifiant";
import { requireProfile } from "@/lib/session";

export async function modifierProfil(formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const nom = String(formData.get("display_name") ?? "").trim();
  const telephone = String(formData.get("telephone") ?? "").trim().slice(0, 30);
  if (!FORMAT_NOM_UTILISATEUR.test(username)) redirect("/compte?erreur=format");

  const { error } = await supabase
    .from("profiles")
    .update({ username, display_name: nom || profile.display_name, telephone })
    .eq("id", profile.id);
  if (error) redirect(`/compte?erreur=${error.code === "23505" ? "pris" : "profil"}`);
  revalidatePath("/", "layout");
  redirect("/compte?profil=1");
}

export async function changerMotDePasse(formData: FormData) {
  const { supabase } = await requireProfile();
  const motDePasse = String(formData.get("mot_de_passe") ?? "");
  if (motDePasse.length < LONGUEUR_MOT_DE_PASSE) redirect("/compte?erreur=court");
  if (motDePasse !== String(formData.get("confirmation") ?? "")) redirect("/compte?erreur=different");

  const { error } = await supabase.auth.updateUser({ password: motDePasse });
  if (error && error.code !== "same_password")
    redirect(`/compte?erreur=mot-de-passe&detail=${encodeURIComponent(error.message)}`);
  redirect("/compte?mot-de-passe=1");
}
