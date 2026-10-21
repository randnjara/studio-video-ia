"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { CLE_ENDPOINT } from "@/lib/runpod";
import { creerServeur } from "@/lib/runpod-admin";
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
