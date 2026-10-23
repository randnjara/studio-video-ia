"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { lireEtatFile } from "@/lib/file-attente";
import { journaliser } from "@/lib/journal";
import { CONTROLES_CLIP } from "@/lib/libelles";
import { lancerPlan, suivreEssais } from "@/lib/production";
import { endpointEco, estMoteur, moteurParDefaut } from "@/lib/runpod";
import { mettreAJourServeur } from "@/lib/runpod-admin";
import { requireProfile } from "@/lib/session";

function retour(projectId: string, params = ""): never {
  revalidatePath(`/projets/${projectId}`, "layout");
  redirect(`/projets/${projectId}/clips${params}`);
}

// Appelée toutes les 10 s par la page tant qu'un clip est en génération. Renvoie le nombre encore en cours.
export async function actualiserEssais(projectId: string): Promise<number> {
  const { supabase } = await requireProfile();
  const { data } = await supabase
    .from("takes")
    .select("id, scene_id, runpod_job_id, moteur, created_at, scenes!takes_scene_id_fkey!inner(project_id, status)")
    .eq("status", "en_cours")
    .eq("scenes.project_id", projectId);
  const essais = (data ?? []).map((t) => ({
    id: t.id,
    scene_id: t.scene_id,
    runpod_job_id: t.runpod_job_id,
    moteur: estMoteur(t.moteur) ? t.moteur : ("qualite" as const),
    sceneValidee: (t.scenes as unknown as { status: string }).status === "validee",
    created_at: t.created_at,
  }));
  if (essais.length === 0) return 0;
  const restants = await suivreEssais(supabase, projectId, essais);
  if (restants < essais.length) revalidatePath(`/projets/${projectId}`, "layout");
  return restants;
}

// Le clip choisi devient celui du plan : il pourra entrer dans un montage
export async function validerClip(projectId: string, sceneId: string, takeId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  // Points à améliorer la prochaine fois : facultatifs, gardés avec le clip
  const controle = {
    a_ameliorer: Object.keys(CONTROLES_CLIP).filter((c) => formData.get(c) === "on"),
    note: String(formData.get("note") ?? "").trim().slice(0, 500),
  };
  await Promise.all([
    supabase
      .from("takes")
      .update({ controle, validated_by: profile.id, validated_at: new Date().toISOString() })
      .eq("id", takeId)
      .eq("scene_id", sceneId),
    supabase
      .from("scenes")
      .update({ validated_take_id: takeId, status: "validee" })
      .eq("id", sceneId)
      .eq("project_id", projectId),
    journaliser(supabase, profile.id, "validation", "essai", takeId, { project_id: projectId, scene_id: sceneId }),
  ]);
  retour(projectId, `?valide=1#plan-${sceneId}`);
}

// Aucun clip ne convient : le plan repart en modification dans la page Plans
export async function refuserClips(projectId: string, sceneId: string) {
  const { supabase, profile } = await requireProfile();
  await Promise.all([
    supabase
      .from("scenes")
      .update({ validated_take_id: null, status: "refusee" })
      .eq("id", sceneId)
      .eq("project_id", projectId),
    journaliser(supabase, profile.id, "refus", "plan", sceneId, { project_id: projectId }),
  ]);
  revalidatePath(`/projets/${projectId}`, "layout");
  redirect(`/projets/${projectId}/plans?refuse=1#plan-${sceneId}`);
}

export async function retirerValidation(projectId: string, sceneId: string) {
  const { supabase } = await requireProfile();
  await supabase
    .from("scenes")
    .update({ validated_take_id: null, status: "a_valider" })
    .eq("id", sceneId)
    .eq("project_id", projectId);
  retour(projectId, `#plan-${sceneId}`);
}

// Supprime un clip raté ou inutile (et sa vidéo dans le stockage)
export async function supprimerClip(projectId: string, sceneId: string, takeId: string) {
  const { supabase } = await requireProfile();
  const [{ data: essai }] = await Promise.all([
    supabase.from("takes").select("video_path").eq("id", takeId).single(),
    supabase.from("scenes").update({ validated_take_id: null }).eq("id", sceneId).eq("validated_take_id", takeId),
  ]);
  await Promise.all([
    supabase.from("takes").delete().eq("id", takeId).eq("scene_id", sceneId),
    essai?.video_path ? supabase.storage.from("medias").remove([essai.video_path]) : null,
  ]);
  retour(projectId, `#plan-${sceneId}`);
}

export async function regenerer(projectId: string, sceneId: string) {
  const { supabase, profile } = await requireProfile();
  const [{ data: projet }, { data: plan }, { data: dernier }] = await Promise.all([
    supabase.from("projects").select("aspect_ratio").eq("id", projectId).single(),
    supabase
      .from("scenes")
      .select("id, motion_prompt, image_path, consent_confirmed, duration_s, status")
      .eq("id", sceneId)
      .eq("project_id", projectId)
      .single(),
    // Un nouvel essai part avec le même moteur que le précédent
    supabase
      .from("takes")
      .select("moteur")
      .eq("scene_id", sceneId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!plan) retour(projectId, "?erreur=plan");
  const moteur = estMoteur(dernier?.moteur) ? dernier.moteur : await moteurParDefaut();
  if (moteur !== "qualite" && (await lireEtatFile(supabase, projectId)).serveurArrete)
    retour(projectId, `?erreur=serveur-arrete#plan-${sceneId}`);
  const serveur = moteur === "qualite" ? null : await endpointEco();
  if (serveur) await mettreAJourServeur(supabase, serveur).catch(() => undefined);
  const erreur = await lancerPlan(supabase, profile.id, plan, projet?.aspect_ratio ?? "16:9", moteur);
  retour(projectId, erreur ? `?erreur=${erreur}#plan-${sceneId}` : `?lances=1#plan-${sceneId}`);
}
