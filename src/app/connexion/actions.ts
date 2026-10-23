"use server";

import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { noterConnexion } from "@/lib/journal-connexion";
import { siteUrl } from "@/lib/site-url";
import { createClient as createServerClient } from "@/lib/supabase/server";

export async function envoyerLien(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/connexion?erreur=email-vide");

  // Lien « implicite » : la session revient dans l'adresse de la page de connexion, si bien que le lien fonctionne
  // aussi ouvert dans un autre navigateur ou sur un autre appareil (application Gmail, téléphone…).
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "implicit", autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Accès sur invitation uniquement : une adresse inconnue ne crée pas de compte.
      shouldCreateUser: false,
      emailRedirectTo: `${await siteUrl()}/connexion`,
    },
  });

  if (error) {
    await noterConnexion(email, "erreur-envoi-lien", `${error.status ?? ""} ${error.code ?? ""} ${error.message}`.trim());
    if (error.status === 429 || error.code === "over_email_send_rate_limit") redirect("/connexion?erreur=trop-de-liens");
    if (/signups? not allowed|user not found/i.test(error.message) || error.code === "otp_disabled")
      redirect("/connexion?erreur=non-invite");
    redirect(`/connexion?erreur=envoi&detail=${encodeURIComponent(error.message)}`);
  }
  await noterConnexion(email, "lien-demande");
  redirect(`/connexion?envoye=${encodeURIComponent(email)}`);
}

// Erreur rapportée par le navigateur (lien expiré ou déjà utilisé)
export async function noterErreurLien(detail: string) {
  await noterConnexion(null, "lien-refuse", detail);
}

// Connexion réussie depuis un lien (la session vient d'être enregistrée par le navigateur)
export async function noterConnexionReussie() {
  const { data } = await (await createServerClient()).auth.getUser();
  if (data.user) await noterConnexion(data.user.email ?? null, "connexion-reussie", "lien");
}
