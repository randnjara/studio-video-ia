"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";

export async function envoyerLien(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/connexion?erreur=email-vide");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Accès sur invitation uniquement : une adresse inconnue ne crée pas de compte.
      shouldCreateUser: false,
      emailRedirectTo: `${await siteUrl()}/auth/callback`,
    },
  });

  if (error) redirect("/connexion?erreur=non-invite");
  redirect(`/connexion?envoye=${encodeURIComponent(email)}`);
}
