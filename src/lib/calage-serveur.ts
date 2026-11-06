import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Cale, type PlanTableau, appliquerCalage } from "@/lib/calage";
import { BUCKET } from "@/lib/production";
import { PRIX_SECONDE_VOIX, lancerVoixWhisper, lireTravailVoix } from "@/lib/runpod";
import { mettreAJourServeurVoix } from "@/lib/runpod-admin";
import { lireServeurVoix } from "@/lib/voix-serveur";

// La voix off AUDIO est la seule source de minutage. Dès qu'elle est importée ou choisie, Whisper (serveur voix) la
// transcrit avec l'horodatage de chaque mot, chaque plan est aligné sur les mots réellement prononcés, puis le tableau est
// réécrit : durée de chaque plan, minutage dans la voix (voice_clips, à découper ensuite), scission des répliques de plus
// de 5 s. L'ancien tableau est gardé dans project_versions (data.tableau) pour pouvoir y revenir.

type Creation = { id: string; nom: string; status: string; audio_path: string | null; mixage_path: string | null; duree_s: number | null; voix?: unknown };

async function voixOff(supabase: SupabaseClient, projectId: string, creationId: string) {
  const { data } = await supabase
    .from("voix_creations")
    .select("id, nom, status, audio_path, mixage_path, duree_s, voix(langue)")
    .eq("id", creationId)
    .eq("project_id", projectId)
    .maybeSingle<Creation>();
  return data;
}

const langueDe = (c: Creation, demandee?: string) =>
  (demandee || String((c.voix as { langue?: string } | null)?.langue ?? "") || "mg").slice(0, 2);

// Lance un travail Whisper sur la voix off : « aligner » (calage des plans) ou « transcrire » (répliques et ton)
export async function lancerWhisper(
  supabase: SupabaseClient,
  projectId: string,
  creationId: string,
  moteur: "aligner" | "transcrire",
  langue?: string,
): Promise<{ jobId: string } | { erreur: string }> {
  const [creation, { serveur, arrete }, { data: plans }] = await Promise.all([
    voixOff(supabase, projectId, creationId),
    lireServeurVoix(supabase),
    supabase.from("scenes").select("id, voiceover_text").eq("project_id", projectId).order("position"),
  ]);
  if (!creation || creation.status !== "terminee") return { erreur: "Choisissez une voix off terminée." };
  const source = creation.mixage_path ?? creation.audio_path;
  if (!source) return { erreur: "Cette voix n'a pas de fichier." };
  if (!serveur) return { erreur: "Le serveur voix n'est pas encore créé : le responsable le crée dans « Équipe et budget »." };
  if (arrete) return { erreur: "Les serveurs sont arrêtés par le responsable. Redémarrez-les pour caler les plans." };
  if (moteur === "aligner" && !plans?.length) return { erreur: "Aucun plan à caler : importez d'abord le tableau." };
  await mettreAJourServeurVoix(supabase, serveur).catch(() => undefined);
  const { data: lien } = await supabase.storage.from(BUCKET).createSignedUrl(source, 60 * 60);
  if (!lien?.signedUrl) return { erreur: "Fichier de la voix off introuvable dans le stockage." };
  try {
    const jobId = await lancerVoixWhisper({
      moteur,
      projetId: projectId,
      sourceUrl: lien.signedUrl,
      langue: langueDe(creation, langue),
      plans: moteur === "aligner" ? (plans ?? []).map((p) => ({ scene_id: p.id, texte: String(p.voiceover_text ?? "") })) : undefined,
      texte: moteur === "transcrire" ? (plans ?? []).map((p) => p.voiceover_text).join(" ") : undefined,
    });
    return { jobId };
  } catch (e) {
    return { erreur: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

async function compterCout(supabase: SupabaseClient, creationId: string, secondes: number | null) {
  if (!secondes) return;
  const { data: c } = await supabase.from("voix_creations").select("cost_usd").eq("id", creationId).maybeSingle();
  await supabase
    .from("voix_creations")
    .update({ cost_usd: Math.round((Number(c?.cost_usd ?? 0) + secondes * PRIX_SECONDE_VOIX) * 10000) / 10000 })
    .eq("id", creationId);
}

export type ResultatCalage = {
  etat: "terminee";
  resume: ReturnType<typeof appliquerCalage>["resume"];
  plans: { numero: number; avant: number; apres: number; statut: string; manquants: string[]; scinde: boolean; aRefaire: boolean }[];
};

// Suit le calage ; quand il est fini, réécrit le tableau d'après l'audio
export async function finirCalage(
  supabase: SupabaseClient,
  auteurId: string,
  projectId: string,
  creationId: string,
  jobId: string,
): Promise<{ etat: "en_cours" } | { erreur: string } | ResultatCalage> {
  let statut;
  try {
    statut = await lireTravailVoix(jobId);
  } catch (e) {
    return { erreur: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  if (statut.etat === "en_cours") return { etat: "en_cours" };
  if (statut.etat === "echouee") return { erreur: statut.erreur };
  const cales = (Array.isArray(statut.sortie.plans) ? statut.sortie.plans : []) as Cale[];
  if (cales.length === 0) return { erreur: "Le serveur voix n'a calé aucun plan." };

  const [{ data: scenes }, { data: projet }, creation] = await Promise.all([
    supabase.from("scenes").select("*").eq("project_id", projectId).order("position"),
    supabase.from("projects").select("scenario_text").eq("id", projectId).maybeSingle(),
    voixOff(supabase, projectId, creationId),
  ]);
  const lignes = (scenes ?? []) as (PlanTableau & Record<string, unknown>)[];
  if (lignes.length === 0) return { erreur: "Aucun plan." };
  // Plans changés depuis le lancement (ajout ou suppression) : on refait le calage plutôt que de mélanger
  const connus = new Set(cales.map((c) => c.scene_id));
  if (lignes.some((l) => !connus.has(l.id))) return { erreur: "Les plans ont changé pendant le calage : relancez-le." };

  const { plans, resume } = appliquerCalage(lignes, cales, () => crypto.randomUUID());
  const parId = new Map(lignes.map((l) => [l.id, l]));

  // 1. L'ancien tableau, pour pouvoir y revenir (le script du projet reste le même)
  const { error: errVersion } = await supabase.from("project_versions").insert({
    project_id: projectId,
    kind: "scenario",
    created_by: auteurId,
    data: {
      scenario_text: projet?.scenario_text ?? "",
      tableau: lignes,
      calage: {
        voix_creation_id: creationId,
        nom: creation?.nom ?? "",
        duree: resume.duree,
        date: new Date().toISOString(),
        scindes: [...new Set(plans.filter((p) => p.nouveau).map((p) => p.origine))].flatMap((o) => plans.filter((p) => p.origine === o).map((p) => p.id)),
        plans: plans.map((p) => ({
          id: p.id,
          debut: p.debut,
          fin: p.fin,
          duree: p.duration_s,
          prononce: p.prononce,
          ton: p.ton,
          description: p.description,
          pause_apres: p.pause_apres,
          statut: p.statut,
        })),
      },
    },
  });
  if (errVersion) return { erreur: `Sauvegarde de l'ancien tableau impossible : ${errVersion.message}` };

  // 2. Le tableau réécrit en un seul appel (places renumérotées : l'unicité de la place est vérifiée en fin de transaction)
  const { updated_at: _, ...modele } = lignes[0];
  void _;
  const rangs = plans.map((p, i) => {
    const origine = parId.get(p.origine)!;
    const { updated_at: __, ...base } = origine;
    void __;
    return {
      ...Object.fromEntries(Object.keys(modele).map((k) => [k, (base as Record<string, unknown>)[k] ?? null])),
      id: p.id,
      position: i + 1,
      voiceover_text: p.voiceover_text,
      motion_prompt: p.motion_prompt,
      duration_s: p.duration_s,
      pose_debut: p.pose_debut,
      pose_fin: p.pose_fin,
      ...(p.nouveau ? { status: "brouillon", validated_take_id: null } : {}),
    };
  });
  const { error: errPlans } = await supabase.from("scenes").upsert(rangs);
  if (errPlans) return { erreur: `Plans non réécrits : ${errPlans.message}` };

  // 3. Minutage dans la voix off : la seule source, à découper ensuite (les anciens morceaux ne servent plus)
  const ids = plans.map((p) => p.id);
  await supabase.from("voice_clips").delete().in("scene_id", ids).eq("source", "ia");
  const { error: errVoix } = await supabase.from("voice_clips").insert(
    plans
      .filter((p) => p.fin > p.debut)
      .map((p) => ({
        scene_id: p.id,
        source: "ia",
        voix_creation_id: creationId,
        audio_path: "",
        debut_s: p.debut,
        fin_s: p.fin,
        texte: (p.prononce || p.voiceover_text).slice(0, 2000),
      })),
  );
  if (errVoix) return { erreur: `Minutage non enregistré : ${errVoix.message}` };
  await compterCout(supabase, creationId, statut.secondes);

  return {
    etat: "terminee",
    resume,
    plans: plans.map((p, i) => ({
      numero: i + 1,
      avant: p.nouveau ? 0 : p.ancienneDuree,
      apres: p.duration_s,
      statut: p.statut,
      manquants: p.manquants.slice(0, 8),
      scinde: p.nouveau || plans.some((q) => q.nouveau && q.origine === p.id),
      aRefaire: p.aRefaire,
    })),
  };
}

// Revient au tableau gardé avant un calage : plans, durées et prompts d'avant ; les plans nés d'une scission disparaissent
export async function restaurerTableau(supabase: SupabaseClient, projectId: string, versionId: number) {
  const { data: version } = await supabase
    .from("project_versions")
    .select("data")
    .eq("id", versionId)
    .eq("project_id", projectId)
    .maybeSingle();
  const tableau = (version?.data as { tableau?: Record<string, unknown>[] } | null)?.tableau;
  if (!tableau?.length) return { erreur: "Cette version ne contient pas de tableau." };
  const { data: actuels } = await supabase.from("scenes").select("id").eq("project_id", projectId);
  const gardes = new Set(tableau.map((t) => String(t.id)));
  const enTrop = (actuels ?? []).map((a) => a.id).filter((id) => !gardes.has(id));
  if (enTrop.length) await supabase.from("scenes").delete().in("id", enTrop).eq("project_id", projectId);
  const { error } = await supabase.from("scenes").upsert(tableau.map(({ updated_at: _, ...t }) => (void _, t)));
  if (error) return { erreur: error.message };
  // Le minutage calé sur l'audio ne correspond plus : il est retiré (le minutage du tableau reprend sa place)
  await supabase.from("voice_clips").delete().in("scene_id", [...gardes]).eq("source", "ia").not("voix_creation_id", "is", null);
  return { erreur: null };
}

// Transcription en répliques horodatées avec le ton, gardée dans project_versions (data.transcription) pour la consigne
// du tableau ; le texte transcrit devient le script du projet s'il n'en a pas encore
export async function finirTranscription(supabase: SupabaseClient, auteurId: string, projectId: string, creationId: string, jobId: string) {
  let statut;
  try {
    statut = await lireTravailVoix(jobId);
  } catch (e) {
    return { erreur: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  if (statut.etat === "en_cours") return { etat: "en_cours" as const };
  if (statut.etat === "echouee") return { erreur: statut.erreur };
  const repliques = Array.isArray(statut.sortie.repliques) ? (statut.sortie.repliques as Record<string, unknown>[]) : [];
  if (repliques.length === 0) return { erreur: "Aucune parole reconnue dans cette voix off." };
  const [{ data: projet }, creation] = await Promise.all([
    supabase.from("projects").select("scenario_text").eq("id", projectId).maybeSingle(),
    voixOff(supabase, projectId, creationId),
  ]);
  const texte = repliques.map((r) => String(r.texte ?? "")).join("\n");
  const script = projet?.scenario_text?.trim() ? projet.scenario_text : texte;
  const { error } = await supabase.from("project_versions").insert({
    project_id: projectId,
    kind: "scenario",
    created_by: auteurId,
    data: {
      scenario_text: script,
      transcription: { voix_creation_id: creationId, nom: creation?.nom ?? "", duree: Number(statut.sortie.duree_voix) || null, repliques },
    },
  });
  if (error) return { erreur: error.message };
  if (!projet?.scenario_text?.trim()) await supabase.from("projects").update({ scenario_text: texte }).eq("id", projectId);
  await compterCout(supabase, creationId, statut.secondes);
  return { etat: "terminee" as const, repliques: repliques.length };
}
