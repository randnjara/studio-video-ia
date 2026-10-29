import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = {
  id: string;
  display_name: string;
  role: "responsable" | "membre";
  active: boolean;
  username: string;
  telephone: string;
  super_admin: boolean;
};

// Un seul client Supabase par affichage, sans appel réseau : les pages peuvent lancer leurs requêtes
// en même temps que la lecture du profil.
export const getClient = cache(createClient);

// Renvoie la personne connectée et son profil, ou renvoie vers la page de connexion.
// Une seule fois par affichage (mise en commun entre le cadre et la page). La session est lue localement ;
// la base revérifie la signature du jeton à chaque requête, donc un faux jeton ne donne accès à rien.
export const requireProfile = cache(async () => {
  const supabase = await getClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/connexion");

  let { data: profile, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, active, username, telephone, super_admin")
    .eq("id", user.id)
    .single<Profile>();
  // Migration 0015 pas encore passée : on lit l'ancien profil plutôt que de bloquer tout le monde
  if (error?.code === "42703") {
    const ancien = await supabase.from("profiles").select("id, display_name, role, active").eq("id", user.id).single();
    profile = ancien.data && { ...ancien.data, username: "", telephone: "", super_admin: false };
  }

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    redirect("/connexion?erreur=compte-inactif");
  }

  return { supabase, user, profile };
});
