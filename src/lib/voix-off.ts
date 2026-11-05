import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dansLaVoix, minuter } from "@/lib/minutage";
import { BUCKET } from "@/lib/production";
import { PRIX_SECONDE_VOIX, lancerDecoupageRunPod, lireDecoupage, type MorceauADecouper } from "@/lib/runpod";
import { mettreAJourServeurVoix } from "@/lib/runpod-admin";
import { lireServeurVoix } from "@/lib/voix-serveur";

// Voix off → un morceau par plan, pour le lip-sync.
// Le minutage vient du tableau importé (colonnes « debut » et « fin », gardées dans voice_clips) ou, à défaut, des durées
// des plans mises bout à bout. Le serveur voix coupe chaque morceau avec ffmpeg (WAV 16 kHz mono), le dépose dans le
// stockage, puis le studio enregistre le fichier et sa durée exacte dans voice_clips.
// Cloudflare limite le nombre d'appels extérieurs par requête : les plans partent par lots (un lien d'envoi par morceau).
export const MORCEAUX_PAR_LOT = 20;

type Plan = { id: string; position: number; duration_s: number | string | null; voiceover_text: string | null };
type Morceau = { id: string; scene_id: string; debut_s: number | string | null; fin_s: number | string | null; created_at: string };

const nombre = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

// Plans du projet dans l'ordre, avec leur minutage et l'identifiant de leur morceau (réutilisé s'il existe déjà)
export async function minutageDuProjet(supabase: SupabaseClient, projectId: string) {
  const { data: plans } = await supabase
    .from("scenes")
    .select("id, position, duration_s, voiceover_text")
    .eq("project_id", projectId)
    .order("position");
  const ids = ((plans ?? []) as Plan[]).map((p) => p.id);
  const { data: existants } = ids.length
    ? await supabase.from("voice_clips").select("id, scene_id, debut_s, fin_s, created_at").in("scene_id", ids).eq("source", "ia").order("created_at", { ascending: false })
    : { data: [] };
  const parPlan = new Map<string, Morceau>();
  for (const m of (existants ?? []) as Morceau[]) if (!parPlan.has(m.scene_id)) parPlan.set(m.scene_id, m);
  return minuter(
    ((plans ?? []) as Plan[]).map((p) => {
      const m = parPlan.get(p.id);
      return {
        sceneId: p.id,
        clipId: m?.id ?? null,
        texte: p.voiceover_text ?? "",
        duree: Number(p.duration_s) || 5,
        debut: nombre(m?.debut_s),
        fin: nombre(m?.fin_s),
      };
    }),
  );
}

// Lance un lot de découpe. Renvoie le numéro du travail RunPod et le lot suivant (null quand c'est le dernier).
export async function lancerLotDecoupage(
  supabase: SupabaseClient,
  projectId: string,
  p: { creationId: string; recaler: boolean; depuis: number },
): Promise<{ jobId: string; total: number; sansVoix: number; suivant: number | null } | { erreur: string }> {
  const [{ data: creation }, minutage, { serveur, arrete }] = await Promise.all([
    supabase
      .from("voix_creations")
      .select("id, status, audio_path, mixage_path, duree_s, voix(langue)")
      .eq("id", p.creationId)
      .eq("project_id", projectId)
      .maybeSingle(),
    minutageDuProjet(supabase, projectId),
    lireServeurVoix(supabase),
  ]);
  if (!creation || creation.status !== "terminee") return { erreur: "Choisissez une voix off terminée du studio voix." };
  // La version mixée est celle posée au montage : le lip-sync suit donc exactement ce que l'on entendra
  const source = (creation.mixage_path ?? creation.audio_path) as string | null;
  if (!source) return { erreur: "Cette voix n'a pas de fichier." };
  if (!serveur) return { erreur: "Le serveur voix n'est pas encore créé : le responsable le crée dans « Équipe et budget »." };
  if (arrete) return { erreur: "Les serveurs sont arrêtés par le responsable. Redémarrez-les pour découper la voix off." };
  if (minutage.length === 0) return { erreur: "Aucun plan : importez d'abord le tableau." };

  // Seuls les plans couverts par la voix off partent (une voix d'une partie du film ne couvre que ses premiers plans).
  // Avec le recalage, le minutage peut être comprimé de 20 % au plus : quelques plans de plus sont envoyés, le serveur
  // voix ignore ceux qui restent hors de la voix.
  const dureeVoix = creation.duree_s !== null && creation.duree_s !== undefined ? Number(creation.duree_s) : null;
  const { couverts, sansVoix, finPrevue } = dansLaVoix(minutage, dureeVoix, p.recaler ? 1.2 : 1);
  if (couverts.length === 0) return { erreur: "Aucun plan ne tombe dans cette voix off." };

  const lot = couverts.slice(p.depuis, p.depuis + MORCEAUX_PAR_LOT);
  if (lot.length === 0) return { erreur: "Rien à découper." };
  const dossier = `${projectId}/voix-off/${p.creationId}`;
  // Le serveur voix passe sur l'image qui sait découper (une seule fois, au premier lot)
  if (p.depuis === 0) await mettreAJourServeurVoix(supabase, serveur).catch(() => undefined);
  const [{ data: lienSource }, ...envois] = await Promise.all([
    supabase.storage.from(BUCKET).createSignedUrl(source, 60 * 60),
    ...lot.map((m) => supabase.storage.from(BUCKET).createSignedUploadUrl(`${dossier}/${m.sceneId}.wav`, { upsert: true })),
  ]);
  if (!lienSource?.signedUrl) return { erreur: "Fichier de la voix off introuvable dans le stockage." };
  const morceaux: MorceauADecouper[] = [];
  for (const [i, m] of lot.entries()) {
    const envoi = envois[i];
    if (envoi.error || !envoi.data) return { erreur: "Impossible de préparer l'envoi des morceaux." };
    morceaux.push({
      id: m.clipId ?? crypto.randomUUID(),
      scene_id: m.sceneId,
      debut: m.debut,
      fin: m.fin,
      texte: m.texte,
      audio_path: `${dossier}/${m.sceneId}.wav`,
      upload_url: envoi.data.signedUrl,
    });
  }
  const langue = String((creation.voix as unknown as { langue?: string } | null)?.langue ?? "").slice(0, 2);
  try {
    const jobId = await lancerDecoupageRunPod({
      sourceUrl: lienSource.signedUrl,
      cle: `${p.creationId}:${source}`,
      langue,
      recaler: p.recaler,
      finPrevue,
      morceaux,
    });
    const suivant = p.depuis + lot.length < couverts.length ? p.depuis + lot.length : null;
    return { jobId, total: couverts.length, sansVoix, suivant };
  } catch (e) {
    return { erreur: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}

// Suit un lot ; quand il est fini, range les morceaux dans voice_clips (fichier, minutage recalé, durée exacte)
export async function finirLotDecoupage(
  supabase: SupabaseClient,
  projectId: string,
  p: { creationId: string; jobId: string },
): Promise<
  | { etat: "en_cours" }
  | { etat: "terminee"; morceaux: number; ignores: number; recale: boolean; avertissement: string | null }
  | { erreur: string }
> {
  let statut;
  try {
    statut = await lireDecoupage(p.jobId);
  } catch (e) {
    return { erreur: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  if (statut.etat === "en_cours") return statut;
  if (statut.etat === "echouee") return { erreur: statut.erreur };
  const dossier = `${projectId}/voix-off/${p.creationId}/`;
  const lignes = statut.morceaux
    .filter((m) => typeof m.audio_path === "string" && m.audio_path.startsWith(dossier) && !m.audio_path.includes("..") && m.duree > 0)
    .map((m) => ({
      id: String(m.id || crypto.randomUUID()),
      scene_id: m.scene_id,
      source: "ia",
      voix_creation_id: p.creationId,
      audio_path: m.audio_path,
      debut_s: Math.round(m.debut * 1000) / 1000,
      fin_s: Math.round(m.fin * 1000) / 1000,
      duration_s: Math.round(m.duree * 1000) / 1000,
      texte: String(m.texte ?? "").slice(0, 2000),
    }));
  const fin = { etat: "terminee" as const, ignores: statut.ignores.length, recale: statut.recale, avertissement: statut.avertissement };
  // Tous les plans du lot tombent après la fin de la voix : rien à enregistrer, ce n'est pas une erreur
  if (lignes.length === 0) return statut.ignores.length > 0 ? { ...fin, morceaux: 0 } : { erreur: "Le serveur voix n'a renvoyé aucun morceau." };
  const { error } = await supabase.from("voice_clips").upsert(lignes);
  if (error) return { erreur: error.message };
  // Le temps de calcul compte dans le budget du mois, avec la voix découpée
  if (statut.secondes) {
    const { data: c } = await supabase.from("voix_creations").select("cost_usd").eq("id", p.creationId).maybeSingle();
    await supabase
      .from("voix_creations")
      .update({ cost_usd: Math.round((Number(c?.cost_usd ?? 0) + statut.secondes * PRIX_SECONDE_VOIX) * 10000) / 10000 })
      .eq("id", p.creationId);
  }
  return { ...fin, morceaux: lignes.length };
}
