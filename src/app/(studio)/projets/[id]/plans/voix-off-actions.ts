"use server";

import { revalidatePath } from "next/cache";
import { journaliser } from "@/lib/journal";
import { requireProfile } from "@/lib/session";
import { finirLotDecoupage, lancerLotDecoupage } from "@/lib/voix-off";

// Découpe de la voix off en un morceau par plan (lip-sync). Le navigateur enchaîne les lots : lancer, suivre, lancer…
export async function lancerDecoupage(projectId: string, creationId: string, recaler: boolean, depuis: number) {
  const { supabase, profile } = await requireProfile();
  const r = await lancerLotDecoupage(supabase, projectId, { creationId, recaler, depuis: Math.max(0, Math.floor(depuis)) });
  if (!("erreur" in r) && depuis === 0)
    await journaliser(supabase, profile.id, "decoupage-voix", "projet", projectId, { voix_creation_id: creationId, recaler });
  return r;
}

export async function suivreDecoupage(projectId: string, creationId: string, jobId: string) {
  const { supabase } = await requireProfile();
  const r = await finirLotDecoupage(supabase, projectId, { creationId, jobId });
  if ("etat" in r && r.etat === "terminee") revalidatePath(`/projets/${projectId}`, "layout");
  return r;
}
