import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Vie des serveurs dans l'historique (arrêt, redémarrage, nouvelle image, création) : un travail déjà fini, sans projet,
// visible par toute l'équipe. Sans la migration 0020, rien n'est noté.
export async function noterEvenementServeur(
  supabase: SupabaseClient,
  type: "serveur-arret" | "serveur-redemarrage" | "serveur-image" | "serveur-creation",
  message: string,
  details: Record<string, unknown> = {},
  serveur: string | null = null,
) {
  try {
    const { data } = await supabase
      .from("travaux_serveur")
      .insert({ project_id: null, type, serveur, statut: "termine", etape: "termine", message, details, fini_at: new Date().toISOString() })
      .select("id")
      .single();
    if (data) await supabase.from("travaux_evenements").insert({ travail_id: data.id, etape: "termine", message });
  } catch {
    // l'historique ne bloque jamais une action
  }
}

export type Travail = {
  id: string;
  project_id: string | null;
  type: string;
  serveur: string | null;
  runpod_job_id: string | null;
  statut: string;
  etape: string;
  progression: number | null;
  message: string;
  erreur: string | null;
  erreur_detail: string | null;
  cout_usd: number | null;
  secondes_gpu: number | null;
  created_by: string | null;
  created_at: string;
  maj_at: string;
  fini_at: string | null;
  travaux_evenements?: { created_at: string; etape: string; message: string; progression: number | null }[];
};

export const CHAMPS_TRAVAIL =
  "id, project_id, type, serveur, runpod_job_id, statut, etape, progression, message, erreur, erreur_detail, cout_usd, secondes_gpu, created_by, created_at, maj_at, fini_at, travaux_evenements(created_at, etape, message, progression)";
