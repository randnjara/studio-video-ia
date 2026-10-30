import type { SupabaseClient } from "@supabase/supabase-js";
import { CLE_ENDPOINT, CLE_ENDPOINT_PHOTO, CLE_ENDPOINT_VACE, CLE_ENDPOINT_VOIX } from "@/lib/runpod";

// Pause et arrêt des générations, gardés dans la table reglages (pas de changement de la base).
// - Pause d'un projet : les photos et vidéos pas encore parties restent dans la file, celles que RunPod n'a pas
//   encore commencées y reviennent ; celles déjà en calcul se terminent. « Reprendre » relance la file.
// - Arrêt du serveur (toute l'équipe) : nos serveurs RunPod n'ont plus le droit d'allumer de machine,
//   donc plus rien n'est facturé. Le service tout prêt « Qualité max » n'est pas concerné.
export const clePause = (projectId: string) => `pause:${projectId}`;
export const CLE_ARRET_SERVEUR = "runpod_arret";

// Valeur de la pause : « pause », ou « reprise:<date> » une fois reprise
export const VALEUR_PAUSE = "pause";
export const valeurReprise = () => `reprise:${new Date().toISOString()}`;

// « auto » : arrêt décidé par le studio lui-même (rien n'avançait chez RunPod), avec la raison affichée
export type ArretServeur = { arrete: boolean; depuis: string; max: Record<string, number>; auto?: string };

export function lireArretServeur(valeur: string | null | undefined): ArretServeur | null {
  if (!valeur) return null;
  try {
    const v = JSON.parse(valeur) as Partial<ArretServeur>;
    return {
      arrete: Boolean(v.arrete),
      depuis: String(v.depuis ?? ""),
      max: v.max ?? {},
      ...(v.auto ? { auto: String(v.auto) } : {}),
    };
  } catch {
    return null;
  }
}

export type EtatFile = {
  enPause: boolean;
  serveurArrete: boolean;
  // Raison de l'arrêt automatique, quand le studio a coupé le serveur lui-même
  arretAuto: string | null;
  // Dernière reprise (pause ou serveur) : une photo ou vidéo restée en attente ne compte son attente qu'à partir de là
  reprise: number;
  serveurVideo: string | null;
  serveurPhoto: string | null;
  serveurVoix: string | null;
  // Serveur Wan 2.2 VACE (moteur « Visage fidèle »)
  serveurVace: string | null;
};

// Lit en un seul appel l'état de la file d'un projet et nos serveurs RunPod
export async function lireEtatFile(supabase: SupabaseClient, projectId: string): Promise<EtatFile> {
  const { data } = await supabase
    .from("reglages")
    .select("cle, valeur")
    .in("cle", [CLE_ENDPOINT, CLE_ENDPOINT_PHOTO, CLE_ENDPOINT_VOIX, CLE_ENDPOINT_VACE, clePause(projectId), CLE_ARRET_SERVEUR]);
  const lire = (cle: string) => data?.find((r) => r.cle === cle)?.valeur || null;
  const pause = lire(clePause(projectId));
  const arret = lireArretServeur(lire(CLE_ARRET_SERVEUR));
  const date = (t: string | null | undefined) => (t ? new Date(t).getTime() || 0 : 0);
  const serveurVideo = process.env.RUNPOD_ENDPOINT_ID || lire(CLE_ENDPOINT);
  return {
    enPause: pause === VALEUR_PAUSE,
    serveurArrete: Boolean(arret?.arrete),
    arretAuto: arret?.arrete ? (arret.auto ?? null) : null,
    reprise: Math.max(
      pause?.startsWith("reprise:") ? date(pause.slice("reprise:".length)) : 0,
      arret && !arret.arrete ? date(arret.depuis) : 0,
    ),
    serveurVideo,
    serveurPhoto: lire(CLE_ENDPOINT_PHOTO) || serveurVideo,
    serveurVoix: lire(CLE_ENDPOINT_VOIX),
    serveurVace: lire(CLE_ENDPOINT_VACE),
  };
}

// Temps d'attente d'une ligne de la file, sans compter les pauses
export const attente = (etat: EtatFile, createdAt: string) =>
  Date.now() - Math.max(new Date(createdAt).getTime(), etat.reprise);
