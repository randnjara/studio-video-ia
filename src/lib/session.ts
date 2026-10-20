import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  display_name: string;
  role: "responsable" | "membre";
  active: boolean;
};

// Renvoie la personne connectée et son profil, ou renvoie vers la page de connexion.
export async function requireProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/connexion");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, role, active")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    redirect("/connexion?erreur=compte-inactif");
  }

  return { supabase, user, profile };
}
