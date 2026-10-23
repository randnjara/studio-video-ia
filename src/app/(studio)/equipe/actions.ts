"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { noterConnexion } from "@/lib/journal-connexion";
import { CLE_ENDPOINT, CLE_VOLUME, endpointEco } from "@/lib/runpod";
import { ajouterStockage, creerServeur } from "@/lib/runpod-admin";
import { requireProfile } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireResponsable() {
  const ctx = await requireProfile();
  if (ctx.profile.role !== "responsable") redirect("/");
  return ctx;
}

export async function inviterMembre(formData: FormData) {
  const { supabase, profile } = await requireResponsable();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const nom = String(formData.get("display_name") ?? "").trim();
  if (!email) redirect("/equipe?erreur=email-vide");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: nom || email.split("@")[0] },
    redirectTo: `${await siteUrl()}/connexion`,
  });
  if (error) redirect(`/equipe?erreur=invitation&detail=${encodeURIComponent(error.message)}`);

  await journaliser(supabase, profile.id, "invitation", "membre", null, { email });
  revalidatePath("/equipe");
  redirect(`/equipe?invite=${encodeURIComponent(email)}`);
}

export async function changerAcces(userId: string, actif: boolean) {
  const { supabase, profile } = await requireResponsable();
  if (userId === profile.id) redirect("/equipe?erreur=soi-meme");

  await supabase.from("profiles").update({ active: actif }).eq("id", userId);
  await journaliser(supabase, profile.id, actif ? "reactivation" : "desactivation", "membre", userId);
  revalidatePath("/equipe");
}

export async function fixerBudget(formData: FormData) {
  const { supabase, profile } = await requireResponsable();
  const montant = Number(String(formData.get("limit_usd") ?? "").replace(",", "."));
  if (!Number.isFinite(montant) || montant < 0) redirect("/equipe?erreur=budget");

  const now = new Date();
  const mois = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  await supabase.from("monthly_budgets").upsert({ month: mois, limit_usd: montant });
  await journaliser(supabase, profile.id, "budget", "budget", null, { mois, montant });
  revalidatePath("/equipe");
  redirect("/equipe?budget=1");
}

// Le nombre de responsables n'est pas limité : l'équipe peut grandir et se réorganiser
export async function changerRole(userId: string, role: "responsable" | "membre") {
  const { supabase, profile } = await requireResponsable();
  if (userId === profile.id) redirect("/equipe?erreur=soi-meme");

  await supabase.from("profiles").update({ role }).eq("id", userId);
  await journaliser(supabase, profile.id, "role", "membre", userId, { role });
  revalidatePath("/equipe");
}

// Crée notre serveur de génération économique chez RunPod et garde son identifiant dans les réglages
export async function creerServeurEco() {
  const { supabase, profile } = await requireResponsable();
  let id: string;
  try {
    id = await creerServeur();
  } catch (e) {
    redirect(`/equipe?erreur=serveur&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  const { error } = await supabase
    .from("reglages")
    .upsert({ cle: CLE_ENDPOINT, valeur: id, updated_at: new Date().toISOString() });
  if (error) redirect(`/equipe?erreur=serveur&detail=${encodeURIComponent(error.message)}`);
  await journaliser(supabase, profile.id, "creation-serveur", "reglage", null, { endpoint_id: id });
  revalidatePath("/", "layout");
  redirect("/equipe?serveur=1");
}

export async function ajouterStockageEco() {
  const { supabase, profile } = await requireResponsable();
  const endpoint = await endpointEco();
  if (!endpoint) redirect("/equipe?erreur=stockage&detail=" + encodeURIComponent("Créez d'abord le serveur économique."));
  let volume: { id: string; centre: string };
  try {
    volume = await ajouterStockage(endpoint);
  } catch (e) {
    redirect(`/equipe?erreur=stockage&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  const { error } = await supabase
    .from("reglages")
    .upsert({ cle: CLE_VOLUME, valeur: `${volume.id} (${volume.centre})`, updated_at: new Date().toISOString() });
  if (error) redirect(`/equipe?erreur=stockage&detail=${encodeURIComponent(error.message)}`);
  await journaliser(supabase, profile.id, "creation-stockage", "reglage", null, volume);
  revalidatePath("/equipe");
  redirect("/equipe?stockage=1");
}

async function emailDe(userId: string) {
  const { data, error } = await createAdminClient().auth.admin.getUserById(userId);
  if (error || !data.user?.email) redirect(`/equipe?erreur=membre&detail=${encodeURIComponent(error?.message ?? "")}`);
  return data.user;
}

// Lien de connexion à copier et envoyer soi-même (WhatsApp, Messenger…) : aucun e-mail, donc pas de limite d'envoi.
// Valable une heure et une seule fois ; il fonctionne sur n'importe quel appareil.
export async function creerLienConnexion(userId: string): Promise<{ lien?: string; erreur?: string }> {
  const { supabase, profile } = await requireResponsable();
  const admin = createAdminClient();
  const { data: u } = await admin.auth.admin.getUserById(userId);
  if (!u.user?.email) return { erreur: "Membre introuvable." };
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error || !data.properties?.hashed_token) return { erreur: error?.message ?? "Lien non créé." };
  await journaliser(supabase, profile.id, "lien-connexion", "membre", userId, { email: u.user.email });
  await noterConnexion(u.user.email, "lien-cree-par-responsable", profile.display_name);
  return { lien: `${await siteUrl()}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink` };
}

// Renvoie par e-mail l'invitation (compte jamais ouvert) ou un lien de connexion
export async function renvoyerLien(userId: string) {
  const { supabase, profile } = await requireResponsable();
  const user = await emailDe(userId);
  const email = user.email!;
  const admin = createAdminClient();
  const { error } = user.email_confirmed_at
    ? await admin.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: `${await siteUrl()}/connexion` },
      })
    : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${await siteUrl()}/connexion` });
  await noterConnexion(
    email,
    error ? "erreur-envoi-lien" : "lien-envoye-par-responsable",
    error ? `${error.status ?? ""} ${error.code ?? ""} ${error.message}`.trim() : profile.display_name,
  );
  if (error) {
    const quota = error.status === 429 || error.code === "over_email_send_rate_limit";
    redirect(`/equipe?erreur=${quota ? "quota" : "renvoi"}&detail=${encodeURIComponent(quota ? "" : error.message)}`);
  }
  await journaliser(supabase, profile.id, "renvoi-lien", "membre", userId, { email });
  redirect(`/equipe?renvoye=${encodeURIComponent(email)}`);
}

// Déconnecte le membre de tous ses appareils : il repart de zéro avec un nouveau lien
export async function reinitialiserConnexion(userId: string) {
  const { supabase, profile } = await requireResponsable();
  const { error } = await supabase.rpc("reinitialiser_sessions", { uid: userId });
  if (error) redirect(`/equipe?erreur=reinitialisation&detail=${encodeURIComponent(error.message)}`);
  await journaliser(supabase, profile.id, "reinitialisation", "membre", userId);
  redirect("/equipe?reinitialise=1");
}

// Supprime le compte. Ses projets, plans et vidéos restent dans le studio.
export async function supprimerMembre(userId: string, formData: FormData) {
  const { supabase, profile } = await requireResponsable();
  if (userId === profile.id) redirect("/equipe?erreur=soi-meme");
  if (formData.get("confirmer") !== "oui") redirect("/equipe?erreur=confirmer");
  const user = await emailDe(userId);
  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  if (error) redirect(`/equipe?erreur=suppression&detail=${encodeURIComponent(error.message)}`);
  await journaliser(supabase, profile.id, "suppression", "membre", null, { email: user.email });
  revalidatePath("/equipe");
  redirect(`/equipe?supprime=${encodeURIComponent(user.email ?? "")}`);
}
