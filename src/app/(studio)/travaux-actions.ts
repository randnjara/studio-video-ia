"use server";

import { annulerJob } from "@/lib/runpod";
import { requireProfile } from "@/lib/session";
import { CHAMPS_TRAVAIL, type Travail } from "@/lib/travaux";

// Frise en direct : les travaux demandés (par numéro RunPod) avec leurs événements, en un seul appel pour toute la page
export async function lireTravaux(jobIds: string[]): Promise<Travail[]> {
  const ids = [...new Set(jobIds.filter((j) => j && j !== "envoi"))].slice(0, 60);
  if (ids.length === 0) return [];
  const { supabase } = await requireProfile();
  const { data } = await supabase.from("travaux_serveur").select(CHAMPS_TRAVAIL).in("runpod_job_id", ids);
  return (data ?? []) as Travail[];
}

// « Annuler » depuis la frise (serveur muet depuis longtemps) : RunPod arrête le travail ; la page qui l'a lancé le voit
// ensuite annulé à son prochain suivi
export async function annulerTravail(jobId: string) {
  const { supabase } = await requireProfile();
  const { data } = await supabase.from("travaux_serveur").select("serveur, type").eq("runpod_job_id", jobId).maybeSingle();
  if (!data?.serveur) return { erreur: "Travail introuvable." };
  const cible = data.type === "video-qualite" ? "qualite" : data.type.startsWith("voix") || ["decoupe", "calage", "transcription"].includes(data.type) ? "voix" : "eco-480";
  await annulerJob(cible, jobId, data.serveur);
  return { erreur: null };
}
