import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Note une étape de connexion (lien demandé, réussite, erreur) pour la page Équipe.
// Ne bloque jamais la connexion : une erreur d'écriture est ignorée.
export async function noterConnexion(email: string | null, evenement: string, detail = "") {
  try {
    const h = await headers();
    await createAdminClient()
      .from("journal_connexion")
      .insert({
        email: email?.toLowerCase().slice(0, 200) ?? null,
        evenement: evenement.slice(0, 60),
        detail: detail.slice(0, 500),
        appareil: (h.get("user-agent") ?? "").slice(0, 300),
      });
  } catch {
    // Journal indisponible (clé secrète absente, table manquante…)
  }
}
