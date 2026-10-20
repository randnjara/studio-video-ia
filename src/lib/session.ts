import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  display_name: string;
  role: "responsable" | "membre";
  active: boolean;
};

// Renvoie la personne connectée et son profil, ou renvoie vers la page de connexion.
// Une seule fois par affichage (mise en commun entre le cadre et la page). L'identité a déjà été
// vérifiée auprès de Supabase par le middleware, et la base revérifie le jeton à chaque requête.
export const requireProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
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
});
