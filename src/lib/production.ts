import type { SupabaseClient } from "@supabase/supabase-js";
import { journaliser } from "@/lib/journal";
import { CLE_ENDPOINT, MOTEURS, type Moteur, lancerGeneration, lireStatut } from "@/lib/runpod";

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

// Ajouté à chaque consigne de mouvement : le visage et la tenue ne doivent pas changer pendant l'animation
const STABILITE =
  "Same person, same face and clothing throughout, subtle natural movements, natural blinking and breathing, no morphing, no sudden change of position.";

type Plan = {
  id: string;
  motion_prompt: string;
  image_path: string | null;
  consent_confirmed: boolean;
  duration_s: number;
  status: string;
};

// Lance une génération pour un plan déjà chargé. Renvoie un code d'erreur, ou null si c'est parti.
export async function lancerPlan(
  supabase: SupabaseClient,
  auteurId: string,
  plan: Plan,
  format: string,
  moteur: Moteur,
) {
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
      cost_usd: (MOTEURS[moteur].prix5s * duree) / 5,
      moteur,
      resolution: moteur === "eco-480" ? "480p" : "720p",
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

    // La vidéo sera rangée à côté des photos du projet ; notre serveur l'y dépose lui-même
    const videoPath = `${plan.image_path.split("/")[0]}/essais/${essai.id}.mp4`;
    let uploadUrl = "";
    if (moteur !== "qualite") {
      const { data: envoi, error: errEnvoi } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(videoPath, { upsert: true });
      if (errEnvoi || !envoi) throw new Error("Impossible de préparer l'envoi de la vidéo.");
      uploadUrl = envoi.signedUrl;
    }

    const jobId = await lancerGeneration({
      moteur,
      prompt: `${plan.motion_prompt.trim().replace(/[.\s]+$/, "")}. ${STABILITE}`,
      imageUrl: signee.signedUrl,
      format,
      duree,
      seed,
      videoPath,
      uploadUrl,
    });
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

// Envoi en lot par une file d'attente : Cloudflare limite chaque requête à 50 appels extérieurs, et lancer
// 34 vidéos d'un coup en demandait plus de 250. La demande inscrit les essais (sans numéro RunPod) ;
// chaque actualisation de la page en envoie quelques-uns et suit les autres.
const ENVOIS_PAR_APPEL = 3;
const SUIVIS_PAR_APPEL = 4;
const ENVOI = "envoi";
const ENVOI_MAX_MS = 3 * 60 * 1000;
const ATTENTE_MAX_MS = 60 * 60 * 1000;

// Inscrit un essai par plan dans la file (un seul appel). Renvoie le nombre inscrit, ou un code d'erreur.
export async function demanderEssais(
  supabase: SupabaseClient,
  auteurId: string,
  projectId: string,
  plans: Plan[],
  moteur: Moteur,
): Promise<{ inscrits: number; erreur: string | null }> {
  const prets = plans.filter((p) => p.image_path && p.motion_prompt && p.consent_confirmed);
  if (prets.length === 0) return { inscrits: 0, erreur: "selection-vide" };
  const { error } = await supabase.from("takes").insert(
    prets.map((plan) => {
      const duree = Number(plan.duration_s) || 5;
      return {
        scene_id: plan.id,
        status: "en_cours",
        seed: Math.floor(Math.random() * 2_000_000_000),
        // Le coût estimé est compté tout de suite, pour que le plafond du mois bloque à temps
        cost_usd: (MOTEURS[moteur].prix5s * duree) / 5,
        moteur,
        resolution: moteur === "eco-480" ? "480p" : "720p",
        created_by: auteurId,
      };
    }),
  );
  if (error) return { inscrits: 0, erreur: error.code === "P0001" ? "budget" : "essai" };
  await Promise.all([
    supabase
      .from("scenes")
      .update({ status: "en_generation" })
      .in(
        "id",
        prets.map((p) => p.id),
      )
      .neq("status", "validee"),
    journaliser(supabase, auteurId, "generation", "projet", projectId, { nombre: prets.length, moteur }),
  ]);
  return { inscrits: prets.length, erreur: null };
}

type EssaiEnCours = {
  id: string;
  scene_id: string;
  runpod_job_id: string | null;
  moteur: Moteur;
  sceneValidee: boolean;
  created_at: string;
};

async function echecEssai(supabase: SupabaseClient, essai: EssaiEnCours, erreur: string) {
  // RunPod ne facture pas les générations ratées
  await supabase
    .from("takes")
    .update({ status: "echouee", cost_usd: 0, error: erreur, finished_at: new Date().toISOString() })
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
}

// Envoie à RunPod quelques essais en attente
async function envoyerEssais(supabase: SupabaseClient, projectId: string, enAttente: EssaiEnCours[], serveurEco: string | null) {
  if (enAttente.length === 0) return;
  const [{ data: projet }, { data: scenes }] = await Promise.all([
    supabase.from("projects").select("aspect_ratio").eq("id", projectId).single(),
    supabase
      .from("scenes")
      .select("id, motion_prompt, image_path, duration_s")
      .in(
        "id",
        enAttente.slice(0, ENVOIS_PAR_APPEL).map((e) => e.scene_id),
      ),
  ]);
  for (const essai of enAttente.slice(0, ENVOIS_PAR_APPEL)) {
    const { data: pris } = await supabase
      .from("takes")
      .update({ runpod_job_id: ENVOI })
      .eq("id", essai.id)
      .is("runpod_job_id", null)
      .select("id, seed")
      .maybeSingle();
    if (!pris) continue; // déjà pris par une autre actualisation
    const plan = scenes?.find((s) => s.id === essai.scene_id);
    try {
      if (!plan?.image_path) throw new Error("Photo introuvable dans le stockage.");
      if (essai.moteur !== "qualite" && !serveurEco) throw new Error("Notre serveur RunPod n'est pas encore créé.");
      const duree = Number(plan.duration_s) || 5;
      // La vidéo sera rangée à côté des photos du projet ; notre serveur l'y dépose lui-même
      const videoPath = `${projectId}/essais/${essai.id}.mp4`;
      const [{ data: signee, error: errSigne }, envoi] = await Promise.all([
        supabase.storage.from(BUCKET).createSignedUrl(plan.image_path, 60 * 60),
        essai.moteur === "qualite"
          ? Promise.resolve(null)
          : supabase.storage.from(BUCKET).createSignedUploadUrl(videoPath, { upsert: true }),
      ]);
      if (errSigne || !signee) throw new Error("Photo introuvable dans le stockage.");
      if (envoi && (envoi.error || !envoi.data)) throw new Error("Impossible de préparer l'envoi de la vidéo.");
      const jobId = await lancerGeneration({
        moteur: essai.moteur,
        prompt: `${plan.motion_prompt.trim().replace(/[.\s]+$/, "")}. ${STABILITE}`,
        imageUrl: signee.signedUrl,
        format: projet?.aspect_ratio ?? "16:9",
        duree,
        seed: Number(pris.seed),
        videoPath,
        uploadUrl: envoi?.data?.signedUrl ?? "",
        serveur: essai.moteur === "qualite" ? undefined : (serveurEco ?? undefined),
      });
      const { error } = await supabase.from("takes").update({ runpod_job_id: jobId }).eq("id", essai.id);
      if (error) throw new Error(error.message);
    } catch (e) {
      await echecEssai(supabase, essai, (e instanceof Error ? e.message : String(e)).slice(0, 500));
    }
  }
}

// Envoie les essais en attente, demande à RunPod où en sont les autres et range les vidéos terminées.
// « envoyer » est faux pendant l'affichage de la page (déjà beaucoup d'appels) : l'envoi se fait par l'actualisation.
// Renvoie le nombre d'essais encore en cours.
export async function suivreEssais(supabase: SupabaseClient, projectId: string, essais: EssaiEnCours[], envoyer = true) {
  if (essais.length === 0) return 0;
  const age = (e: EssaiEnCours) => Date.now() - new Date(e.created_at).getTime();
  const { data: reglage } = await supabase.from("reglages").select("valeur").eq("cle", CLE_ENDPOINT).maybeSingle();
  const serveurEco = process.env.RUNPOD_ENDPOINT_ID || reglage?.valeur || null;
  let finis = 0;

  // Coupé pendant l'envoi ou jamais envoyé (page fermée) : en échec, pour être relancé
  const perdus = essais.filter(
    (e) => (e.runpod_job_id === ENVOI && age(e) > ENVOI_MAX_MS) || (!e.runpod_job_id && age(e) > ATTENTE_MAX_MS),
  );
  for (const e of perdus)
    await echecEssai(supabase, e, e.runpod_job_id ? "Le lancement a été interrompu. Relancez ce plan." : "Vidéo jamais envoyée (page fermée). Relancez ce plan.");
  finis += perdus.length;
  if (envoyer)
    await envoyerEssais(
      supabase,
      projectId,
      essais.filter((e) => !e.runpod_job_id && age(e) <= ATTENTE_MAX_MS).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      serveurEco,
    );

  // Les plus anciens d'abord : RunPod traite sa file dans l'ordre, ce sont eux qui finissent en premier
  const parties = essais
    .filter((e) => e.runpod_job_id && e.runpod_job_id !== ENVOI)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, SUIVIS_PAR_APPEL);
  const resultats = await Promise.all(
    parties.map(async (essai) => {
      let statut;
      try {
        statut = await lireStatut(essai.moteur, essai.runpod_job_id!, essai.moteur === "qualite" ? undefined : (serveurEco ?? undefined));
      } catch {
        return 0;
      }
      if (statut.etat === "en_cours") return 0;

      if (statut.etat === "echouee") {
        await echecEssai(supabase, essai, statut.erreur);
        return 1;
      }
      const chemin = `${projectId}/essais/${essai.id}.mp4`;
      if (statut.videoPath) {
        // Notre serveur a déjà déposé la vidéo : on vérifie seulement que c'est bien le chemin prévu
        if (statut.videoPath !== chemin) return 0;
      } else if (statut.videoUrl) {
        const video = await fetch(statut.videoUrl);
        if (!video.ok) return 0;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(chemin, await video.arrayBuffer(), { contentType: "video/mp4", upsert: true });
        if (error) return 0;
      } else return 0;
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
      return 1;
    }),
  );
  return essais.length - finis - resultats.reduce<number>((n, r) => n + r, 0);
}
