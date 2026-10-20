"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { PRIX_ESTIME_5S_USD, lancerGeneration, lireStatut } from "@/lib/runpod";
import { requireProfile } from "@/lib/session";

const BUCKET = "medias";
const TYPES_PHOTO: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_MAX_OCTETS = 10 * 1024 * 1024;

function retour(projectId: string, params = ""): never {
  revalidatePath(`/projets/${projectId}/plans`);
  redirect(`/projets/${projectId}/plans${params}`);
}

// Dépose la photo d'un plan dans le stockage et renvoie son chemin, ou null s'il n'y en a pas
async function deposerPhoto(
  supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"],
  projectId: string,
  sceneId: string,
  fichier: FormDataEntryValue | null,
) {
  if (!(fichier instanceof File) || fichier.size === 0) return null;
  const ext = TYPES_PHOTO[fichier.type];
  if (!ext) retour(projectId, "?erreur=photo-format");
  if (fichier.size > PHOTO_MAX_OCTETS) retour(projectId, "?erreur=photo-taille");

  const chemin = `${projectId}/photos/${sceneId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(chemin, fichier, { contentType: fichier.type });
  if (error) retour(projectId, "?erreur=photo-envoi");
  return chemin;
}

export async function ajouterPlan(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();

  const { data: dernier } = await supabase
    .from("scenes")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: scene, error } = await supabase
    .from("scenes")
    .insert({
      project_id: projectId,
      position: (dernier?.position ?? 0) + 1,
      motion_prompt: String(formData.get("motion_prompt") ?? "").trim(),
      voiceover_text: String(formData.get("voiceover_text") ?? "").trim(),
      consent_confirmed: formData.get("consent_confirmed") === "on",
    })
    .select("id")
    .single();
  if (error || !scene) retour(projectId, "?erreur=plan");

  const photo = await deposerPhoto(supabase, projectId, scene.id, formData.get("photo"));
  if (photo) await supabase.from("scenes").update({ image_path: photo }).eq("id", scene.id);

  await journaliser(supabase, profile.id, "ajout", "plan", scene.id);
  retour(projectId, `#plan-${scene.id}`);
}

export async function modifierPlan(projectId: string, sceneId: string, formData: FormData) {
  const { supabase } = await requireProfile();
  const photo = await deposerPhoto(supabase, projectId, sceneId, formData.get("photo"));

  const { error } = await supabase
    .from("scenes")
    .update({
      motion_prompt: String(formData.get("motion_prompt") ?? "").trim(),
      voiceover_text: String(formData.get("voiceover_text") ?? "").trim(),
      consent_confirmed: formData.get("consent_confirmed") === "on",
      ...(photo ? { image_path: photo } : {}),
    })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  if (error) retour(projectId, "?erreur=plan");
  retour(projectId, `?enregistre=1#plan-${sceneId}`);
}

export async function supprimerPlan(projectId: string, sceneId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase.from("scenes").delete().eq("id", sceneId).eq("project_id", projectId);
  await journaliser(supabase, profile.id, "suppression", "plan", sceneId);
  retour(projectId);
}

export async function deplacerPlan(projectId: string, sceneId: string, sens: -1 | 1) {
  const { supabase } = await requireProfile();
  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position");
  const liste = scenes ?? [];
  const i = liste.findIndex((s) => s.id === sceneId);
  const voisin = liste[i + sens];
  if (i < 0 || !voisin) retour(projectId);

  // Échange en trois temps, car deux plans ne peuvent pas avoir la même place
  const a = liste[i];
  await supabase.from("scenes").update({ position: -1 }).eq("id", a.id);
  await supabase.from("scenes").update({ position: a.position }).eq("id", voisin.id);
  await supabase.from("scenes").update({ position: voisin.position }).eq("id", a.id);
  retour(projectId, `#plan-${sceneId}`);
}

export async function genererEssai(projectId: string, sceneId: string) {
  const { supabase, profile } = await requireProfile();

  const [{ data: scene }, { data: projet }] = await Promise.all([
    supabase
      .from("scenes")
      .select("id, motion_prompt, image_path, consent_confirmed, duration_s, status")
      .eq("id", sceneId)
      .eq("project_id", projectId)
      .single(),
    supabase.from("projects").select("aspect_ratio").eq("id", projectId).single(),
  ]);
  if (!scene || !projet) retour(projectId, "?erreur=plan");
  if (!scene.image_path) retour(projectId, `?erreur=sans-photo#plan-${sceneId}`);
  if (!scene.motion_prompt) retour(projectId, `?erreur=sans-prompt#plan-${sceneId}`);
  if (!scene.consent_confirmed) retour(projectId, `?erreur=sans-accord#plan-${sceneId}`);

  const duree = Number(scene.duration_s) || 5;
  const seed = Math.floor(Math.random() * 2_000_000_000);

  // Le coût estimé est compté tout de suite, pour que le plafond du mois bloque à temps
  const { data: essai, error } = await supabase
    .from("takes")
    .insert({
      scene_id: sceneId,
      status: "en_cours",
      seed,
      cost_usd: (PRIX_ESTIME_5S_USD * duree) / 5,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !essai) {
    retour(projectId, error?.code === "P0001" ? "?erreur=budget" : "?erreur=essai");
  }

  try {
    const { data: signee, error: errSigne } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(scene.image_path, 60 * 60);
    if (errSigne || !signee) throw new Error("Photo introuvable dans le stockage.");

    const jobId = await lancerGeneration({
      prompt: scene.motion_prompt,
      imageUrl: signee.signedUrl,
      format: projet.aspect_ratio,
      duree,
      seed,
    });
    await supabase.from("takes").update({ runpod_job_id: jobId }).eq("id", essai.id);
    if (scene.status !== "validee") {
      await supabase.from("scenes").update({ status: "en_generation" }).eq("id", sceneId);
    }
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

  await journaliser(supabase, profile.id, "generation", "essai", essai.id, { scene_id: sceneId });
  retour(projectId, `#plan-${sceneId}`);
}

// Interroge RunPod pour les essais en cours du projet et range les vidéos terminées.
// Appelée régulièrement par la page tant qu'un essai tourne. Renvoie le nombre d'essais encore en cours.
export async function actualiserEssais(projectId: string): Promise<number> {
  const { supabase } = await requireProfile();
  const { data: essais } = await supabase
    .from("takes")
    .select("id, scene_id, runpod_job_id, scenes!inner(project_id, status)")
    .eq("status", "en_cours")
    .eq("scenes.project_id", projectId);

  let restants = 0;
  for (const essai of essais ?? []) {
    if (!essai.runpod_job_id) {
      restants++;
      continue;
    }
    let statut;
    try {
      statut = await lireStatut(essai.runpod_job_id);
    } catch {
      restants++;
      continue;
    }

    if (statut.etat === "en_cours") {
      restants++;
    } else if (statut.etat === "echouee") {
      // RunPod ne facture pas les générations ratées
      await supabase
        .from("takes")
        .update({ status: "echouee", cost_usd: 0, error: statut.erreur, finished_at: new Date().toISOString() })
        .eq("id", essai.id)
        .eq("status", "en_cours");
    } else {
      const video = await fetch(statut.videoUrl);
      if (!video.ok) {
        restants++;
        continue;
      }
      const chemin = `${projectId}/essais/${essai.id}.mp4`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(chemin, await video.arrayBuffer(), { contentType: "video/mp4", upsert: true });
      if (error) {
        restants++;
        continue;
      }
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
      const scene = essai.scenes as unknown as { status: string };
      if (scene.status !== "validee") {
        await supabase.from("scenes").update({ status: "a_valider" }).eq("id", essai.scene_id);
      }
    }
  }
  return restants;
}

export async function validerEssai(projectId: string, sceneId: string, takeId: string) {
  const { supabase, profile } = await requireProfile();
  await supabase
    .from("scenes")
    .update({ validated_take_id: takeId, status: "validee" })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  await journaliser(supabase, profile.id, "validation", "essai", takeId, { scene_id: sceneId });
  retour(projectId, `#plan-${sceneId}`);
}

export async function annulerValidation(projectId: string, sceneId: string) {
  const { supabase } = await requireProfile();
  await supabase
    .from("scenes")
    .update({ validated_take_id: null, status: "a_valider" })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  retour(projectId, `#plan-${sceneId}`);
}
