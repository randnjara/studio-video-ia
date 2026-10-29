import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export const FORMAT_NOM_UTILISATEUR = /^[a-z0-9._-]{3,30}$/;
export const LONGUEUR_MOT_DE_PASSE = 8;

// Les 9 derniers chiffres suffisent à reconnaître un numéro, écrit 034…, +261 34… ou 261 34…
export const chiffresTelephone = (t: string) => t.replace(/\D/g, "").slice(-9);

// Retrouve le compte à partir de ce que la personne a tapé : nom d'utilisateur, e-mail ou numéro de téléphone.
export async function compteDepuisIdentifiant(saisie: string): Promise<{ id: string; email: string } | null> {
  const identifiant = saisie.trim().toLowerCase();
  if (!identifiant) return null;
  const admin = createAdminClient();

  let id: string | undefined;
  if (identifiant.includes("@")) {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = data?.users.find((x) => x.email?.toLowerCase() === identifiant);
    return u?.email ? { id: u.id, email: u.email } : null;
  }
  if (FORMAT_NOM_UTILISATEUR.test(identifiant)) {
    const { data } = await admin.from("profiles").select("id").eq("username", identifiant).maybeSingle();
    id = data?.id;
  }
  if (!id && chiffresTelephone(identifiant).length === 9) {
    const { data } = await admin.from("profiles").select("id, telephone").neq("telephone", "");
    id = data?.find((p) => chiffresTelephone(p.telephone) === chiffresTelephone(identifiant))?.id;
  }
  if (!id) return null;
  const { data } = await admin.auth.admin.getUserById(id);
  return data.user?.email ? { id, email: data.user.email } : null;
}
