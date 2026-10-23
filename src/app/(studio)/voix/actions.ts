"use server";

import { revalidatePath } from "next/cache";
import { journaliser } from "@/lib/journal";
import { requireProfile } from "@/lib/session";
import { AGES, GENRES, LANGUES, LANGUES_PERSONNE, type MoteurVoix, codeChatterbox, differences, lireReglages } from "@/lib/voix";

const genre = (v: unknown) => (typeof v === "string" && v in GENRES ? v : "autre");
const age = (v: unknown) => (typeof v === "string" && v in AGES ? v : "adulte");
const texte = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

function retour() {
  revalidatePath("/voix");
  revalidatePath("/projets", "layout");
}

const erreurBase = (message: string) =>
  message.includes("voix") && message.includes("does not exist")
    ? "La base n'est pas encore à jour (migration 0014 à appliquer)."
    : `Ajout impossible : ${message}`;

// Voix d'une personne : son enregistrement (déjà envoyé dans le dossier voix/ du stockage) sert de modèle
export async function ajouterVoixPersonne(p: {
  nom: string;
  langue: string;
  genre: string;
  age: string;
  chemin: string;
  accord: boolean;
  commercial: boolean;
  description: string;
}) {
  const { supabase, profile } = await requireProfile();
  if (!p.accord) return { erreur: "Cochez la case : la personne doit être d'accord pour que sa voix soit utilisée." };
  if (!/^voix\/[\w-]+\.\w+$/.test(p.chemin)) return { erreur: "Enregistrement refusé." };
  const nom = texte(p.nom);
  if (!nom) return { erreur: "Donnez un nom à cette voix." };
  const langue = LANGUES_PERSONNE.includes(p.langue) ? p.langue : "mg";
  const { data, error } = await supabase
    .from("voix")
    .insert({
      nom,
      langue,
      genre: genre(p.genre),
      age: age(p.age),
      moteur: "personne" satisfies MoteurVoix,
      // Malgache (et toute langue que Chatterbox ne parle pas) : MMS dit le texte, puis la voix est convertie
      modele: codeChatterbox(langue) ?? "mlg",
      reference_path: p.chemin,
      description: texte(p.description, 300),
      usage_commercial: p.commercial,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { erreur: erreurBase(error.message) };
  await journaliser(supabase, profile.id, "ajout-voix", "voix", data.id, { nom });
  retour();
  return { erreur: null };
}

// Réglages de la table de mixage gardés comme une nouvelle voix (ex. « Grand-mère du film »)
export async function ajouterPreset(p: { voixId: string; nom: string; genre: string; age: string; reglages: unknown }) {
  const { supabase, profile } = await requireProfile();
  const { data: base } = await supabase
    .from("voix")
    .select("langue, moteur, modele, reference_path, usage_commercial, nom")
    .eq("id", p.voixId)
    .maybeSingle();
  if (!base) return { erreur: "La voix de départ n'existe plus." };
  const nom = texte(p.nom);
  if (!nom) return { erreur: "Donnez un nom à cette voix." };
  const { error } = await supabase.from("voix").insert({
    nom,
    langue: base.langue,
    genre: genre(p.genre),
    age: age(p.age),
    moteur: base.moteur,
    modele: base.modele,
    reference_path: base.reference_path,
    reglages: differences(lireReglages(p.reglages)),
    description: `Réglages de table de mixage sur « ${base.nom} ».`,
    usage_commercial: base.usage_commercial,
    created_by: profile.id,
  });
  if (error) return { erreur: erreurBase(error.message) };
  retour();
  return { erreur: null };
}

// Voix toute prête d'un modèle déjà installé (pour les connaisseurs) : un autre code langue MMS, une voix Kokoro…
export async function ajouterVoixModele(formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const moteur = String(formData.get("moteur"));
  const modele = texte(formData.get("modele"), 40);
  const langue = texte(formData.get("langue"), 10);
  const nom = texte(formData.get("nom"));
  if (!["mms", "kokoro", "chatterbox"].includes(moteur) || !/^[\w-]+$/.test(modele) || !nom || !(langue in LANGUES))
    return { erreur: "Remplissez le nom, la langue, le moteur et le code du modèle." };
  if (moteur === "chatterbox" && !codeChatterbox(modele)) return { erreur: "Chatterbox ne connaît pas ce code de langue." };
  const { error } = await supabase.from("voix").insert({
    nom,
    langue,
    genre: genre(formData.get("genre")),
    age: age(formData.get("age")),
    moteur,
    modele,
    description: texte(formData.get("description"), 300),
    // Seul MMS (Meta) interdit l'usage commercial
    usage_commercial: moteur !== "mms",
    created_by: profile.id,
  });
  if (error) return { erreur: erreurBase(error.message) };
  retour();
  return { erreur: null };
}

export async function supprimerVoix(voixId: string) {
  const { supabase, profile } = await requireProfile();
  const { data } = await supabase.from("voix").select("reference_path, nom").eq("id", voixId).maybeSingle();
  if (!data) return;
  const { error } = await supabase.from("voix").delete().eq("id", voixId);
  if (error) return;
  // L'enregistrement n'est supprimé que si plus aucune voix ne s'en sert
  if (data.reference_path) {
    const { count } = await supabase.from("voix").select("id", { count: "exact", head: true }).eq("reference_path", data.reference_path);
    if (!count) await supabase.storage.from("medias").remove([data.reference_path]);
  }
  await journaliser(supabase, profile.id, "suppression-voix", "voix", voixId, { nom: data.nom });
  retour();
}
