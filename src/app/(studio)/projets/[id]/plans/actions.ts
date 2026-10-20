"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { MOUVEMENT_PAR_DEFAUT } from "@/lib/libelles";
import { PRIX_ESTIME_5S_USD, lancerGeneration, lireStatut } from "@/lib/runpod";
import { requireProfile } from "@/lib/session";

const BUCKET = "medias";

function retour(projectId: string, params = ""): never {
  revalidatePath(`/projets/${projectId}/plans`);
  redirect(`/projets/${projectId}/plans${params}`);
}

// Les photos sont envoyées directement par le navigateur dans le stockage ;
// on vérifie seulement que le chemin reçu appartient bien à ce projet.
function cheminPhoto(projectId: string, valeur: FormDataEntryValue | string | null | undefined) {
  const chemin = String(valeur ?? "");
  return chemin.startsWith(`${projectId}/photos/`) && !chemin.includes("..") ? chemin : null;
}

async function prochainePosition(supabase: Awaited<ReturnType<typeof requireProfile>>["supabase"], projectId: string) {
  const { data: dernier } = await supabase
    .from("scenes")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (dernier?.position ?? 0) + 1;
}

export async function ajouterPlan(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();

  const { data: scene, error } = await supabase
    .from("scenes")
    .insert({
      project_id: projectId,
      position: await prochainePosition(supabase, projectId),
      motion_prompt: String(formData.get("motion_prompt") ?? "").trim(),
      voiceover_text: String(formData.get("voiceover_text") ?? "").trim(),
      consent_confirmed: formData.get("consent_confirmed") === "on",
      image_path: cheminPhoto(projectId, formData.get("image_path")),
    })
    .select("id")
    .single();
  if (error || !scene) retour(projectId, "?erreur=plan");

  await journaliser(supabase, profile.id, "ajout", "plan", scene.id);
  retour(projectId, `?ajoute=1#plan-${scene.id}`);
}

// Crée d'un coup un plan par scène du script, avec les photos dans l'ordre
export async function importerPlans(
  projectId: string,
  plans: { voix: string; mouvement: string; image_path: string | null }[],
  accord: boolean,
) {
  const { supabase, profile } = await requireProfile();
  if (plans.length === 0) retour(projectId, "?erreur=import-vide");

  const debut = await prochainePosition(supabase, projectId);
  const { error } = await supabase.from("scenes").insert(
    plans.slice(0, 200).map((p, i) => ({
      project_id: projectId,
      position: debut + i,
      voiceover_text: p.voix.trim(),
      motion_prompt: p.mouvement.trim() || MOUVEMENT_PAR_DEFAUT,
      image_path: cheminPhoto(projectId, p.image_path),
      consent_confirmed: accord,
    })),
  );
  if (error) retour(projectId, "?erreur=import");

  await journaliser(supabase, profile.id, "import", "plan", null, { nombre: plans.length });
  retour(projectId, `?importe=${plans.length}`);
}

export async function modifierPlan(projectId: string, sceneId: string, formData: FormData) {
  const { supabase } = await requireProfile();
  const photo = cheminPhoto(projectId, formData.get("image_path"));

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

type Ctx = Awaited<ReturnType<typeof requireProfile>>;

// Lance une génération pour un plan. Renvoie un code d'erreur, ou null si c'est parti.
async function lancerPlan({ supabase, profile }: Ctx, projectId: string, sceneId: string, format: string) {
  const { data: scene } = await supabase
    .from("scenes")
    .select("id, motion_prompt, image_path, consent_confirmed, duration_s, status")
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .single();
  if (!scene) return "plan";
  if (!scene.image_path) return "sans-photo";
  if (!scene.motion_prompt) return "sans-prompt";
  if (!scene.consent_confirmed) return "sans-accord";

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
  if (error || !essai) return error?.code === "P0001" ? "budget" : "essai";

  try {
    const { data: signee, error: errSigne } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(scene.image_path, 60 * 60);
    if (errSigne || !signee) throw new Error("Photo introuvable dans le stockage.");

    const jobId = await lancerGeneration({
      prompt: scene.motion_prompt,
      imageUrl: signee.signedUrl,
      format,
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
  return null;
}

async function formatProjet(supabase: Ctx["supabase"], projectId: string) {
  const { data } = await supabase.from("projects").select("aspect_ratio").eq("id", projectId).single();
  return data?.aspect_ratio ?? "16:9";
}

export async function genererEssai(projectId: string, sceneId: string) {
  const ctx = await requireProfile();
  const erreur = await lancerPlan(ctx, projectId, sceneId, await formatProjet(ctx.supabase, projectId));
  retour(projectId, erreur ? `?erreur=${erreur}#plan-${sceneId}` : `#plan-${sceneId}`);
}

// Lance la génération de tous les plans prêts qui n'ont encore aucune vidéo
export async function genererTout(projectId: string) {
  const ctx = await requireProfile();
  const format = await formatProjet(ctx.supabase, projectId);
  const { data: scenes } = await ctx.supabase
    .from("scenes")
    .select("id, image_path, motion_prompt, consent_confirmed, takes(status)")
    .eq("project_id", projectId)
    .order("position");

  const aLancer = (scenes ?? []).filter(
    (s) =>
      s.image_path &&
      s.motion_prompt &&
      s.consent_confirmed &&
      !(s.takes as { status: string }[]).some((t) => t.status === "en_cours" || t.status === "terminee"),
  );
  let lances = 0;
  for (const s of aLancer) {
    const erreur = await lancerPlan(ctx, projectId, s.id, format);
    if (erreur === "budget") retour(projectId, `?erreur=budget&lances=${lances}`);
    if (!erreur) lances++;
  }
  retour(projectId, `?lances=${lances}`);
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
  revalidatePath(`/projets/${projectId}`);
  retour(projectId, `?valide=1#plan-${sceneId}`);
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
