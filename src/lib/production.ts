import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/journal";
import { PRIX_ESTIME_5S_USD, lancerGeneration, lireStatut } from "@/lib/runpod";

// Outils côté serveur partagés par les pages Plans, Clips et Montage.

export const BUCKET = "medias";

// Liens temporaires (1 h) pour afficher les photos et vidéos privées, en une seule requête
export async function signerLiens(supabase: SupabaseClient, chemins: (string | null | undefined)[]) {
  const uniques = [...new Set(chemins.filter((c): c is string => Boolean(c)))];
  const liens = new Map<string, string>();
  if (uniques.length === 0) return liens;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(uniques, 60 * 60);
  for (const s of data ?? []) if (s.path && s.signedUrl) liens.set(s.path, s.signedUrl);
  return liens;
}

// Le statut affiché sur la liste des projets suit l'avancement réel
export async function majStatutProjet(supabase: SupabaseClient, projectId: string) {
  const [{ data: projet }, { count }, { data: montages }] = await Promise.all([
    supabase.from("projects").select("status").eq("id", projectId).single(),
    supabase.from("scenes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("montages").select("status").eq("project_id", projectId),
  ]);
  if (!projet || projet.status === "livre" || projet.status === "archive") return;
  const statuts = (montages ?? []).map((m) => m.status);
  const statut = statuts.includes("valide")
    ? "valide"
    : statuts.includes("a_valider")
      ? "a_valider"
      : statuts.length > 0
        ? "montage"
        : (count ?? 0) > 0
          ? "production"
          : "scenario";
  if (statut !== projet.status) await supabase.from("projects").update({ status: statut }).eq("id", projectId);
}

// Un projet tout neuf passe en « production » dès son premier plan (une seule requête)
export async function marquerEnProduction(supabase: SupabaseClient, projectId: string) {
  await supabase.from("projects").update({ status: "production" }).eq("id", projectId).eq("status", "scenario");
}

type Plan = {
  id: string;
  motion_prompt: string;
  image_path: string | null;
  consent_confirmed: boolean;
  duration_s: number;
  status: string;
};

// Lance une génération pour un plan déjà chargé. Renvoie un code d'erreur, ou null si c'est parti.
export async function lancerPlan(supabase: SupabaseClient, auteurId: string, plan: Plan, format: string) {
  if (!plan.image_path) return "sans-photo";
  if (!plan.motion_prompt) return "sans-prompt";
  if (!plan.consent_confirmed) return "sans-accord";

  const duree = Number(plan.duration_s) || 5;
  const seed = Math.floor(Math.random() * 2_000_000_000);

  // Le coût estimé est compté tout de suite, pour que le plafond du mois bloque à temps
  const { data: essai, error } = await supabase
    .from("takes")
    .insert({
      scene_id: plan.id,
      status: "en_cours",
      seed,
      cost_usd: (PRIX_ESTIME_5S_USD * duree) / 5,
      created_by: auteurId,
    })
    .select("id")
    .single();
  if (error || !essai) return error?.code === "P0001" ? "budget" : "essai";

  try {
    const { data: signee, error: errSigne } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(plan.image_path, 60 * 60);
    if (errSigne || !signee) throw new Error("Photo introuvable dans le stockage.");

    const jobId = await lancerGeneration({ prompt: plan.motion_prompt, imageUrl: signee.signedUrl, format, duree, seed });
    await Promise.all([
      supabase.from("takes").update({ runpod_job_id: jobId }).eq("id", essai.id),
      plan.status === "validee"
        ? null
        : supabase.from("scenes").update({ status: "en_generation" }).eq("id", plan.id),
    ]);
  } catch (e) {
    await supabase
      .from("takes")
      .update({
        status: "echouee",
        cost_usd: 0,
        error: e instanceof Error ? e.message : String(e),
        finished_at: new Date().toISOString(),
      })
      .eq("id", essai.id);
  }
  await journaliser(supabase, auteurId, "generation", "essai", essai.id, { scene_id: plan.id });
  return null;
}

type EssaiEnCours = { id: string; scene_id: string; runpod_job_id: string | null; sceneValidee: boolean };

// Demande à RunPod où en sont les essais donnés et range les vidéos terminées dans le stockage.
// Renvoie le nombre d'essais encore en cours.
export async function suivreEssais(supabase: SupabaseClient, projectId: string, essais: EssaiEnCours[]) {
  const resultats = await Promise.all(
    essais.map(async (essai) => {
      if (!essai.runpod_job_id) return 1;
      let statut;
      try {
        statut = await lireStatut(essai.runpod_job_id);
      } catch {
        return 1;
      }
      if (statut.etat === "en_cours") return 1;

      if (statut.etat === "echouee") {
        // RunPod ne facture pas les générations ratées
        await supabase
          .from("takes")
          .update({ status: "echouee", cost_usd: 0, error: statut.erreur, finished_at: new Date().toISOString() })
          .eq("id", essai.id)
          .eq("status", "en_cours");
        if (!essai.sceneValidee) {
          // Le plan revient « à valider » s'il a déjà une autre vidéo réussie, sinon « brouillon »
          const { count } = await supabase
            .from("takes")
            .select("id", { count: "exact", head: true })
            .eq("scene_id", essai.scene_id)
            .eq("status", "terminee");
          await supabase
            .from("scenes")
            .update({ status: count ? "a_valider" : "brouillon" })
            .eq("id", essai.scene_id);
        }
        return 0;
      }

      const video = await fetch(statut.videoUrl);
      if (!video.ok) return 1;
      const chemin = `${projectId}/essais/${essai.id}.mp4`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(chemin, await video.arrayBuffer(), { contentType: "video/mp4", upsert: true });
      if (error) return 1;
      await supabase
        .from("takes")
        .update({
          status: "terminee",
          video_path: chemin,
          gpu_seconds: statut.secondes,
          ...(statut.coutUsd !== null ? { cost_usd: statut.coutUsd } : {}),
          finished_at: new Date().toISOString(),
        })
        .eq("id", essai.id)
        .eq("status", "en_cours");
      if (!essai.sceneValidee) await supabase.from("scenes").update({ status: "a_valider" }).eq("id", essai.scene_id);
      return 0;
    }),
  );
  return resultats.reduce<number>((n, r) => n + r, 0);
}
