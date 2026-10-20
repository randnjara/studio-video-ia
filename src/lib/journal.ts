import type { SupabaseClient } from "@supabase/supabase-js";

// Ajoute une ligne au journal d'activité (visible par le responsable).
export async function journaliser(
  supabase: SupabaseClient,
  actorId: string,
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await supabase.from("activity_log").insert({
    actor_id: actorId,
    action,
    entity,
    entity_id: entityId,
    details,
  });
}
