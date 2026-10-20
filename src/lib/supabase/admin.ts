import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client avec la clé secrète : contourne la sécurité par ligne.
// À n'utiliser que dans des actions serveur, après avoir vérifié que l'appelant est responsable.
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
