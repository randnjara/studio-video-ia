"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { noterConnexion } from "@/lib/journal-connexion";
import { CLE_ENDPOINT, CLE_ENDPOINT_PHOTO, CLE_ENDPOINT_VOIX, CLE_VOLUME, endpointEco } from "@/lib/runpod";
import {
  CLE_CACHE_PHOTO,
  CLE_CACHE_VIDEO,
  ajouterStockage,
  creerServeur,
  creerServeursCache,
  creerServeurVoix,
  supprimerAncienServeurEtDisque,
} from "@/lib/runpod-admin";
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
  const data = { display_name: nom || email.split("@")[0] };
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { data, redirectTo: `${await siteUrl()}/connexion` });
  if (error && (error.status === 429 || error.code === "over_email_send_rate_limit")) {
    // Limite d'e-mails atteinte : le compte est créé sans e-mail, le responsable envoie lui-même le lien de connexion
    const cree = await admin.auth.admin.generateLink({ type: "invite", email, options: { data } });
    if (cree.error || !cree.data.user)
      redirect(`/equipe?erreur=invitation&detail=${encodeURIComponent(cree.error?.message ?? "")}`);
    await noterConnexion(email, "compte-cree-sans-email", profile.display_name);
    await journaliser(supabase, profile.id, "invitation", "membre", cree.data.user.id, { email });
    revalidatePath("/equipe");
    redirect(`/equipe?sans-email=${encodeURIComponent(email)}&membre=${cree.data.user.id}#membre-${cree.data.user.id}`);
  }
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

// Crée le serveur du studio voix (petite carte, sa propre image) et garde son identifiant dans les réglages
export async function creerServeurVoixAction() {
  const { supabase, profile } = await requireResponsable();
  let id: string;
  try {
    id = await creerServeurVoix();
  } catch (e) {
    redirect(`/equipe?erreur=serveur-voix&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#voix`);
  }
  const { error } = await supabase
    .from("reglages")
    .upsert({ cle: CLE_ENDPOINT_VOIX, valeur: id, updated_at: new Date().toISOString() });
  if (error) redirect(`/equipe?erreur=serveur-voix&detail=${encodeURIComponent(error.message)}#voix`);
  await journaliser(supabase, profile.id, "creation-serveur-voix", "reglage", null, { endpoint_id: id });
  revalidatePath("/", "layout");
  redirect("/equipe?voix=1#voix");
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
  // Compte jamais ouvert : lien d'invitation ; sinon lien de connexion
  const type = u.user.email_confirmed_at ? "magiclink" : "invite";
  const { data, error } = await admin.auth.admin.generateLink({ type, email: u.user.email });
  if (error || !data.properties?.hashed_token) return { erreur: error?.message ?? "Lien non créé." };
  await journaliser(supabase, profile.id, "lien-connexion", "membre", userId, { email: u.user.email });
  await noterConnexion(u.user.email, "lien-cree-par-responsable", profile.display_name);
  return { lien: `${await siteUrl()}/connexion/lien?token_hash=${data.properties.hashed_token}&type=${type}` };
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

// Cache gratuit de RunPod, étape 1 : deux nouveaux serveurs (vidéo, photo), sans disque payant
export async function creerServeursCacheAction() {
  const { supabase, profile } = await requireResponsable();
  let ids: { video: string; photo: string };
  try {
    ids = await creerServeursCache();
  } catch (e) {
    redirect(`/equipe?erreur=serveur&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  const maintenant = new Date().toISOString();
  await supabase.from("reglages").upsert([
    { cle: CLE_CACHE_VIDEO, valeur: ids.video, updated_at: maintenant },
    { cle: CLE_CACHE_PHOTO, valeur: ids.photo, updated_at: maintenant },
  ]);
  await journaliser(supabase, profile.id, "creation-serveurs-cache", "reglage", null, ids);
  redirect("/equipe?cache=1#cache");
}

// Étape 3 : le studio utilise les nouveaux serveurs ; l'ancien serveur et le disque payant sont supprimés
export async function passerAuCache(formData: FormData) {
  const { supabase, profile } = await requireResponsable();
  if (formData.get("confirmer") !== "oui") redirect("/equipe?erreur=confirmer-cache#cache");
  const { data } = await supabase.from("reglages").select("cle, valeur").in("cle", [CLE_CACHE_VIDEO, CLE_CACHE_PHOTO]);
  const video = data?.find((r) => r.cle === CLE_CACHE_VIDEO)?.valeur;
  const photo = data?.find((r) => r.cle === CLE_CACHE_PHOTO)?.valeur;
  if (!video || !photo) redirect("/equipe?erreur=cache-absent#cache");
  const ancien = await endpointEco();

  const maintenant = new Date().toISOString();
  await supabase.from("reglages").upsert([
    { cle: CLE_ENDPOINT, valeur: video, updated_at: maintenant },
    { cle: CLE_ENDPOINT_PHOTO, valeur: photo, updated_at: maintenant },
  ]);
  await supabase.from("reglages").delete().in("cle", [CLE_CACHE_VIDEO, CLE_CACHE_PHOTO]);
  await journaliser(supabase, profile.id, "passage-cache", "reglage", null, { video, photo, ancien });
  revalidatePath("/", "layout");

  try {
    await supprimerAncienServeurEtDisque(ancien && ancien !== video ? ancien : null);
  } catch (e) {
    redirect(`/equipe?erreur=suppression-disque&detail=${encodeURIComponent(e instanceof Error ? e.message : String(e))}#cache`);
  }
  await supabase.from("reglages").delete().eq("cle", CLE_VOLUME);
  redirect("/equipe?passe-cache=1");
}
