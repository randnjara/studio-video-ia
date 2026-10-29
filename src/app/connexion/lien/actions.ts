"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { noterConnexion } from "@/lib/journal-connexion";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["magiclink", "invite", "signup", "recovery", "email"];

export async function confirmerLien(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;
  if (!tokenHash || !TYPES.includes(type)) redirect("/connexion?erreur=lien-invalide");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  await noterConnexion(
    data.user?.email ?? null,
    error ? "lien-refuse" : "connexion-reussie",
    error ? `lien copié : ${error.message}` : "lien copié",
  );
  if (error) redirect("/connexion?erreur=lien-invalide");
  redirect(type === "recovery" ? "/compte?nouveau=1" : "/");
}
