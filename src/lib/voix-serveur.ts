import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLE_ARRET_SERVEUR, lireArretServeur } from "@/lib/file-attente";
import { CLE_ENDPOINT_VOIX, PRIX_VOIX_ESTIME_USD, annulerJob, lancerVoixRunPod, lireStatut } from "@/lib/runpod";
import { mettreAJourServeurVoix } from "@/lib/runpod-admin";
import { CHAMPS_VOIX, type Voix, pourServeur } from "@/lib/voix";

const BUCKET = "medias";
// Une voix qui n'a pas répondu après 20 min est considérée comme perdue
const ATTENTE_MAX_MS = 20 * 60 * 1000;

export type Creation = {
  id: string;
  voix_id: string | null;
  nom: string;
  texte: string;
  source_path: string | null;
  status: "en_cours" | "terminee" | "echouee";
  audio_path: string | null;
  mixage_path: string | null;
  reglages: Record<string, unknown>;
  emotion: number;
  duree_s: number | null;
  runpod_job_id: string | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
};

export const CHAMPS_CREATION =
  "id, voix_id, nom, texte, source_path, status, audio_path, mixage_path, reglages, emotion, duree_s, runpod_job_id, cost_usd, error, created_at";

// Serveur voix, et s'il est arrêté par le responsable (« Arrêter le serveur »)
export async function lireServeurVoix(supabase: SupabaseClient) {
  const { data } = await supabase.from("reglages").select("cle, valeur").in("cle", [CLE_ENDPOINT_VOIX, CLE_ARRET_SERVEUR]);
  const lire = (cle: string) => data?.find((r) => r.cle === cle)?.valeur || null;
  return { serveur: lire(CLE_ENDPOINT_VOIX), arrete: Boolean(lireArretServeur(lire(CLE_ARRET_SERVEUR))?.arrete) };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

// Inscrit une voix à créer puis l'envoie tout de suite au serveur voix.
// Texte → voix avec « voix », ou enregistrement transformé (« source ») avec la voix d'une personne.
export async function lancerCreation(
  supabase: SupabaseClient,
  auteurId: string,
  projectId: string,
  p: { voixId: string; texte: string; emotion: number; nom: string; sourcePath?: string },
): Promise<{ erreur: string | null }> {
  const [{ data: voix }, { serveur, arrete }] = await Promise.all([
    supabase.from("voix").select(CHAMPS_VOIX).eq("id", p.voixId).maybeSingle<Voix>(),
    lireServeurVoix(supabase),
  ]);
  if (!voix) return { erreur: "Cette voix n'existe plus." };
  if (!serveur) return { erreur: "Le serveur voix n'est pas encore créé : le responsable le crée dans « Équipe et budget »." };
  if (arrete) return { erreur: "Les serveurs sont arrêtés par le responsable. Redémarrez-les pour créer des voix." };
  if (p.sourcePath && !voix.reference_path) return { erreur: "Pour transformer un enregistrement, choisissez la voix d'une personne." };

  const { data: creation, error } = await supabase
    .from("voix_creations")
    .insert({
      project_id: projectId,
      voix_id: voix.id,
      nom: p.nom || voix.nom,
      texte: p.sourcePath ? "" : p.texte,
      source_path: p.sourcePath ?? null,
      emotion: p.emotion,
      reglages: voix.reglages ?? {},
      seed: Math.floor(Math.random() * 2_000_000_000),
      cost_usd: PRIX_VOIX_ESTIME_USD,
      created_by: auteurId,
    })
    .select("id, seed")
    .single();
  if (error || !creation) {
    if (error?.code === "P0001") return { erreur: "Le budget GPU du mois est atteint. Demandez au responsable de l'augmenter." };
    return {
      erreur: error?.message.includes("voix_creations")
        ? "La base n'est pas encore à jour (migration 0014 à appliquer)."
        : `Création impossible : ${error?.message}`,
    };
  }

  const audioPath = `${projectId}/voix/${creation.id}.wav`;
  try {
    const liensALire = [voix.reference_path, p.sourcePath].filter((c): c is string => Boolean(c));
    const [{ data: envoi, error: errEnvoi }, { data: liens }] = await Promise.all([
      supabase.storage.from(BUCKET).createSignedUploadUrl(audioPath, { upsert: true }),
      liensALire.length
        ? supabase.storage.from(BUCKET).createSignedUrls(liensALire, 60 * 60)
        : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
      mettreAJourServeurVoix(supabase, serveur).catch(() => undefined),
    ]);
    if (errEnvoi || !envoi) throw new Error(errEnvoi?.message ?? "lien d'envoi");
    const lien = (c: string | null | undefined) => (c ? (liens?.find((l) => l.path === c)?.signedUrl ?? undefined) : undefined);
    const referenceUrl = lien(voix.reference_path);
    if (voix.reference_path && !referenceUrl) throw new Error("L'enregistrement de cette voix est introuvable.");
    const cible = pourServeur(voix);
    const jobId = await lancerVoixRunPod({
      moteur: p.sourcePath ? "conversion" : cible.moteur,
      modele: cible.modele,
      texte: p.texte,
      emotion: p.emotion,
      seed: Number(creation.seed),
      referenceUrl,
      sourceUrl: lien(p.sourcePath),
      audioPath,
      uploadUrl: envoi.signedUrl,
    });
    await supabase.from("voix_creations").update({ runpod_job_id: jobId }).eq("id", creation.id);
    return { erreur: null };
  } catch (e) {
    await supabase
      .from("voix_creations")
      .update({ status: "echouee", error: message(e), cost_usd: 0, finished_at: new Date().toISOString() })
      .eq("id", creation.id);
    return { erreur: message(e) };
  }
}

// Demande au serveur voix où en sont les voix en cours du projet ; renvoie le nombre encore en cours
export async function suivreCreations(supabase: SupabaseClient, projectId: string): Promise<number> {
  const { data } = await supabase
    .from("voix_creations")
    .select("id, runpod_job_id, created_at")
    .eq("project_id", projectId)
    .eq("status", "en_cours");
  const enCours = data ?? [];
  if (enCours.length === 0) return 0;
  const { serveur } = await lireServeurVoix(supabase);
  let restants = 0;
  await Promise.all(
    enCours.map(async (c) => {
      const fin = new Date().toISOString();
      const perdue = Date.now() - new Date(c.created_at).getTime() > ATTENTE_MAX_MS;
      if (!c.runpod_job_id || !serveur) {
        if (perdue)
          await supabase
            .from("voix_creations")
            .update({ status: "echouee", error: "La voix n'a jamais été envoyée.", cost_usd: 0, finished_at: fin })
            .eq("id", c.id);
        else restants++;
        return;
      }
      const statut = await lireStatut("voix", c.runpod_job_id, serveur).catch(() => null);
      if (!statut || statut.etat === "en_cours") {
        if (perdue) {
          await annulerJob("voix", c.runpod_job_id, serveur);
          await supabase
            .from("voix_creations")
            .update({ status: "echouee", error: "Le serveur voix n'a pas répondu à temps.", cost_usd: 0, finished_at: fin })
            .eq("id", c.id);
        } else restants++;
        return;
      }
      if (statut.etat === "echouee" || !statut.audioPath?.startsWith(`${projectId}/voix/`)) {
        const erreur = statut.etat === "echouee" ? statut.erreur : "Le serveur n'a pas renvoyé de voix.";
        await supabase.from("voix_creations").update({ status: "echouee", error: erreur, cost_usd: 0, finished_at: fin }).eq("id", c.id);
        return;
      }
      await supabase
        .from("voix_creations")
        .update({
          status: "terminee",
          audio_path: statut.audioPath,
          duree_s: statut.duree ?? null,
          gpu_seconds: statut.secondes,
          finished_at: fin,
          ...(statut.coutUsd !== null ? { cost_usd: statut.coutUsd } : {}),
        })
        .eq("id", c.id);
    }),
  );
  return restants;
}
