"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { journaliser } from "@/lib/journal";
import { MOUVEMENT_PAR_DEFAUT } from "@/lib/libelles";
import { demanderEssais, marquerEnProduction } from "@/lib/production";
import { demanderPhotos, suivrePhotos } from "@/lib/photos";
import { agrandirStockage, mettreAJourServeur } from "@/lib/runpod-admin";
import { endpointEco, endpointPhoto, estMoteur, moteursDisponibles } from "@/lib/runpod";
import { requireProfile } from "@/lib/session";

// Les références du film se gèrent à l'étape 1 (Infos)
function versInfos(projectId: string, params = ""): never {
  revalidatePath(`/projets/${projectId}`, "layout");
  redirect(`/projets/${projectId}${params}`);
}

function retour(projectId: string, params = ""): never {
  revalidatePath(`/projets/${projectId}`, "layout");
  redirect(`/projets/${projectId}/plans${params}`);
}

// Les photos sont envoyées directement par le navigateur dans le stockage ;
// on vérifie seulement que le chemin reçu appartient bien à ce projet.
function cheminPhoto(projectId: string, valeur: FormDataEntryValue | string | null | undefined) {
  const chemin = String(valeur ?? "");
  return chemin.startsWith(`${projectId}/photos/`) && !chemin.includes("..") ? chemin : null;
}

// Champs de la fiche de tournage d'un plan, lus dans un formulaire
const CHAMPS_FICHE = ["cadrage", "angle", "lieu", "intention", "pose_debut", "pose_fin"] as const;
function fiche(formData: FormData) {
  return Object.fromEntries(CHAMPS_FICHE.map((c) => [c, String(formData.get(c) ?? "").trim().slice(0, 300)]));
}

type Supabase = Awaited<ReturnType<typeof requireProfile>>["supabase"];

async function prochainePosition(supabase: Supabase, projectId: string) {
  const { data: dernier } = await supabase
    .from("scenes")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (dernier?.position ?? 0) + 1;
}

export async function ajouterPlan(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();

  const { data: scene, error } = await supabase
    .from("scenes")
    .insert({
      project_id: projectId,
      position: await prochainePosition(supabase, projectId),
      motion_prompt: String(formData.get("motion_prompt") ?? "").trim(),
      voiceover_text: String(formData.get("voiceover_text") ?? "").trim(),
      image_description: String(formData.get("image_description") ?? "").trim(),
      ...fiche(formData),
      consent_confirmed: formData.get("consent_confirmed") === "on",
      image_path: cheminPhoto(projectId, formData.get("image_path")),
    })
    .select("id")
    .single();
  if (error || !scene) retour(projectId, "?erreur=plan");

  await Promise.all([
    journaliser(supabase, profile.id, "ajout", "plan", scene.id, { project_id: projectId }),
    marquerEnProduction(supabase, projectId),
  ]);
  retour(projectId, `?ajoute=1#plan-${scene.id}`);
}

// Crée d'un coup un plan par scène du script, avec les photos dans l'ordre.
// Le script est gardé dans le projet, avec une copie dans l'historique s'il a changé.
export async function importerPlans(
  projectId: string,
  script: string,
  plans: { voix: string; mouvement: string; image_path: string | null }[],
  accord: boolean,
) {
  const { supabase, profile } = await requireProfile();
  if (plans.length === 0) retour(projectId, "?erreur=import-vide");

  const [debut, { data: projet }] = await Promise.all([
    prochainePosition(supabase, projectId),
    supabase.from("projects").select("scenario_text").eq("id", projectId).single(),
  ]);
  const { error } = await supabase.from("scenes").insert(
    plans.slice(0, 200).map((p, i) => ({
      project_id: projectId,
      position: debut + i,
      voiceover_text: p.voix.trim(),
      motion_prompt: p.mouvement.trim() || MOUVEMENT_PAR_DEFAUT,
      image_path: cheminPhoto(projectId, p.image_path),
      consent_confirmed: accord,
    })),
  );
  if (error) retour(projectId, "?erreur=import");

  await Promise.all([
    script.trim() && projet && projet.scenario_text !== script
      ? Promise.all([
          supabase.from("projects").update({ scenario_text: script }).eq("id", projectId),
          supabase
            .from("project_versions")
            .insert({ project_id: projectId, kind: "scenario", data: { scenario_text: script }, created_by: profile.id }),
        ])
      : null,
    journaliser(supabase, profile.id, "import", "plan", null, { project_id: projectId, nombre: plans.length }),
    marquerEnProduction(supabase, projectId),
  ]);
  retour(projectId, `?importe=${plans.length}`);
}

export async function modifierPlan(projectId: string, sceneId: string, formData: FormData) {
  const { supabase } = await requireProfile();
  const photo = cheminPhoto(projectId, formData.get("image_path"));

  const [{ error }] = await Promise.all([
    supabase
      .from("scenes")
      .update({
        motion_prompt: String(formData.get("motion_prompt") ?? "").trim(),
        voiceover_text: String(formData.get("voiceover_text") ?? "").trim(),
        image_description: String(formData.get("image_description") ?? "").trim(),
        ...fiche(formData),
        consent_confirmed: formData.get("consent_confirmed") === "on",
        ...(photo ? { image_path: photo } : {}),
      })
      .eq("id", sceneId)
      .eq("project_id", projectId),
    // Un plan refusé que l'on corrige redevient prêt à générer
    supabase.from("scenes").update({ status: "brouillon" }).eq("id", sceneId).eq("status", "refusee"),
  ]);
  if (error) retour(projectId, "?erreur=plan");
  retour(projectId, `?enregistre=1#plan-${sceneId}`);
}

// Photos de départ faites ailleurs (ChatGPT, ordinateur personnel…) : chaque photo envoyée devient celle de son plan
export async function attacherPhotos(projectId: string, photos: { sceneId: string; chemin: string }[]) {
  const { supabase } = await requireProfile();
  const valides = photos
    .map((p) => ({ sceneId: p.sceneId, chemin: cheminPhoto(projectId, p.chemin) }))
    .filter((p): p is { sceneId: string; chemin: string } => Boolean(p.chemin));
  if (valides.length === 0) retour(projectId, "?erreur=photos-importees");
  const resultats = await Promise.all(
    valides.map((p) =>
      supabase.from("scenes").update({ image_path: p.chemin }).eq("id", p.sceneId).eq("project_id", projectId),
    ),
  );
  if (resultats.some((r) => r.error)) retour(projectId, "?erreur=photos-importees");
  retour(projectId, `?photos-importees=${valides.length}&ouvert=1`);
}

export async function supprimerPlan(projectId: string, sceneId: string) {
  const { supabase, profile } = await requireProfile();
  await Promise.all([
    supabase.from("scenes").delete().eq("id", sceneId).eq("project_id", projectId),
    journaliser(supabase, profile.id, "suppression", "plan", sceneId, { project_id: projectId }),
  ]);
  retour(projectId, "?supprime=1&ouvert=1");
}

export async function supprimerPlans(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const ids = formData.getAll("plans").map(String).filter(Boolean);
  if (ids.length === 0) retour(projectId, "?ouvert=1");
  await Promise.all([
    supabase.from("scenes").delete().in("id", ids).eq("project_id", projectId),
    journaliser(supabase, profile.id, "suppression", "plan", null, { project_id: projectId, nombre: ids.length }),
  ]);
  retour(projectId, `?supprime=${ids.length}&ouvert=1`);
}

export async function deplacerPlan(projectId: string, sceneId: string, sens: -1 | 1) {
  const { supabase } = await requireProfile();
  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position");
  const liste = scenes ?? [];
  const i = liste.findIndex((s) => s.id === sceneId);
  const voisin = liste[i + sens];
  if (i < 0 || !voisin) retour(projectId);

  // Échange en trois temps, car deux plans ne peuvent pas avoir la même place
  const a = liste[i];
  await supabase.from("scenes").update({ position: -1 }).eq("id", a.id);
  await supabase.from("scenes").update({ position: a.position }).eq("id", voisin.id);
  await supabase.from("scenes").update({ position: voisin.position }).eq("id", a.id);
  retour(projectId, `?ouvert=1#plan-${sceneId}`);
}

// Envoie à la génération les plans cochés (ou tous les plans prêts si « tous » est demandé)
export async function envoyerALaGeneration(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const tous = formData.get("tous") === "1";
  const choisis = new Set(formData.getAll("plans").map(String));
  const demande = formData.get("moteur");
  const disponibles = await moteursDisponibles();
  const moteur = estMoteur(demande) && disponibles.includes(demande) ? demande : disponibles[0];
  const serveur = moteur === "qualite" ? null : await endpointEco();
  if (serveur) await mettreAJourServeur(supabase, serveur).catch(() => undefined);

  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, motion_prompt, image_path, consent_confirmed, duration_s, status, takes!takes_scene_id_fkey(status)")
    .eq("project_id", projectId)
    .order("position");

  const aLancer = (scenes ?? []).filter((s) => {
    const essais = s.takes as { status: string }[];
    if (essais.some((t) => t.status === "en_cours")) return false;
    // « Tous » : seulement les plans prêts qui n'ont encore aucune vidéo réussie
    // Un plan sans photo, sans mouvement ou sans accord ne peut pas partir
    if (!s.image_path || !s.motion_prompt || !s.consent_confirmed) return false;
    return tous ? !essais.some((t) => t.status === "terminee") : choisis.has(s.id);
  });
  if (aLancer.length === 0) retour(projectId, "?erreur=selection-vide");

  // Les essais sont inscrits dans la file ; la page Clips les envoie quelques-uns à la fois (limite d'appels de
  // Cloudflare) et RunPod les traite en parallèle
  const { inscrits, erreur } = await demanderEssais(supabase, profile.id, projectId, aLancer, moteur);

  revalidatePath(`/projets/${projectId}`, "layout");
  if (inscrits === 0) retour(projectId, `?erreur=${erreur ?? "essai"}`);
  redirect(`/projets/${projectId}/clips?lances=${inscrits}`);
}

export async function restaurerScript(projectId: string, versionId: number) {
  const { supabase } = await requireProfile();
  const { data: version } = await supabase
    .from("project_versions")
    .select("data")
    .eq("id", versionId)
    .eq("project_id", projectId)
    .single();
  if (!version) retour(projectId);
  const texte = String((version.data as { scenario_text?: string }).scenario_text ?? "");
  await supabase.from("projects").update({ scenario_text: texte }).eq("id", projectId);
  retour(projectId, "?script-restaure=1#script");
}

// --- Références du film et photos de départ (Qwen-Image-Edit sur notre serveur) ---

export async function ajouterReference(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const nom = String(formData.get("nom") ?? "").trim();
  const image = cheminPhoto(projectId, formData.get("image_path"));
  if (!nom || !image) versInfos(projectId, "?erreur=reference#references");
  const genre = String(formData.get("genre") ?? "personnage");
  const { error } = await supabase.from("film_refs").insert({
    project_id: projectId,
    nom: nom.slice(0, 60),
    genre: ["personnage", "lieu", "objet", "style"].includes(genre) ? genre : "personnage",
    description: String(formData.get("description") ?? "").trim().slice(0, 300),
    image_path: image,
    created_by: profile.id,
  });
  if (error) versInfos(projectId, "?erreur=reference#references");
  versInfos(projectId, "?reference=1#references");
}

// Une photo de plan réussie devient la référence de son lieu : les photos suivantes gardent le même décor
export async function garderDecor(projectId: string, sceneId: string) {
  const { supabase, profile } = await requireProfile();
  const { data: plan } = await supabase
    .from("scenes")
    .select("lieu, image_path")
    .eq("id", sceneId)
    .eq("project_id", projectId)
    .single();
  if (!plan?.lieu?.trim() || !plan.image_path) retour(projectId, `?erreur=decor#plan-${sceneId}`);
  await supabase.from("film_refs").insert({
    project_id: projectId,
    nom: plan.lieu.trim().slice(0, 60),
    genre: "lieu",
    description: "décor seulement : garder la pièce, les meubles et la lumière, ignorer la personne de cette photo",
    image_path: plan.image_path,
    created_by: profile.id,
  });
  retour(projectId, `?decor=1#plan-${sceneId}`);
}

export async function supprimerReference(projectId: string, refId: string) {
  const { supabase } = await requireProfile();
  await supabase.from("film_refs").delete().eq("id", refId).eq("project_id", projectId);
  versInfos(projectId, "#references");
}

export async function creerPhotos(projectId: string, formData: FormData) {
  const { supabase, profile } = await requireProfile();
  const serveur = await endpointPhoto();
  if (!serveur) retour(projectId, "?erreur=sans-serveur");
  // Ancien fonctionnement avec disque : il doit tenir les deux modèles. Le serveur doit avoir la dernière image.
  await Promise.all([
    agrandirStockage().catch(() => undefined),
    mettreAJourServeur(supabase, serveur).catch(() => undefined),
  ]);
  const choisis = new Set(formData.getAll("plans").map(String));

  const [{ data: projet }, { data: scenes }, { data: refs }] = await Promise.all([
    supabase.from("projects").select("id, aspect_ratio, style_text").eq("id", projectId).single(),
    supabase
      .from("scenes")
      .select("id, image_description, cadrage, angle, lieu, intention, pose_debut, photos(status)")
      .eq("project_id", projectId)
      .order("position"),
    // La première référence ajoutée pour un nom (la photo maîtresse) passe toujours en premier
    supabase
      .from("film_refs")
      .select("id, nom, genre, description, image_path")
      .eq("project_id", projectId)
      .order("created_at"),
  ]);
  if (!projet) retour(projectId, "?erreur=photo");
  const tous = scenes ?? [];
  const aLancer = tous
    .map((s, i) => ({ ...s, numero: i + 1 }))
    .filter((s) => choisis.has(s.id) && s.image_description.trim() && !(s.photos as { status: string }[]).some((p) => p.status === "en_cours"));
  if (aLancer.length === 0) retour(projectId, "?erreur=selection-vide");

  // Les photos sont inscrites dans la file ; la page les envoie quelques-unes à la fois à chaque actualisation
  // (voir suivrePhotos), car Cloudflare limite le nombre d'appels par requête. Le serveur les enchaîne sans recharger le modèle.
  const { inscrites, sansReference, erreur } = await demanderPhotos(supabase, profile.id, aLancer, refs ?? []);
  if (inscrites > 0) await journaliser(supabase, profile.id, "photos", "projet", projectId, { nombre: inscrites });
  const code = erreur ?? (inscrites === 0 ? "sans-reference" : null);
  retour(
    projectId,
    `?photos=${inscrites}${sansReference ? `&sansref=${sansReference}` : ""}${code ? `&erreur=${code}` : ""}&ouvert=1`,
  );
}

// Appelée toutes les 10 s par la page tant que des photos sont en cours ; renvoie le nombre restant
export async function actualiserPhotos(projectId: string): Promise<number> {
  const { supabase } = await requireProfile();
  const { data } = await supabase
    .from("photos")
    .select("id, scene_id, runpod_job_id, created_at, scenes!inner(project_id)")
    .eq("status", "en_cours")
    .eq("scenes.project_id", projectId);
  const enCours = data ?? [];
  if (enCours.length === 0) return 0;
  await suivrePhotos(supabase, projectId, enCours);
  const { count } = await supabase
    .from("photos")
    .select("id, scenes!inner(project_id)", { count: "exact", head: true })
    .eq("status", "en_cours")
    .eq("scenes.project_id", projectId);
  return count ?? 0;
}

export type LigneTableau = {
  voix: string;
  mouvement: string;
  description: string;
  cadrage: string;
  angle: string;
  lieu: string;
  intention: string;
  pose_debut: string;
  pose_fin: string;
  duree: number | null;
};

// Import d'un tableau de scènes (CSV, par exemple le tableau maître d'un projet préparé ailleurs) : un plan par ligne
export async function importerTableau(projectId: string, lignes: LigneTableau[], accord: boolean) {
  const { supabase, profile } = await requireProfile();
  if (lignes.length === 0) retour(projectId, "?erreur=import-vide");
  const debut = await prochainePosition(supabase, projectId);
  const court = (t: string, n = 300) => String(t ?? "").trim().slice(0, n);
  const { error } = await supabase.from("scenes").insert(
    lignes.slice(0, 300).map((l, i) => ({
      project_id: projectId,
      position: debut + i,
      voiceover_text: court(l.voix, 2000),
      // Pas de mouvement passe-partout : chaque plan devra recevoir le sien (leçon du Projet Mama)
      motion_prompt: court(l.mouvement, 2000),
      image_description: court(l.description, 2000),
      cadrage: court(l.cadrage),
      angle: court(l.angle),
      lieu: court(l.lieu),
      intention: court(l.intention),
      pose_debut: court(l.pose_debut),
      pose_fin: court(l.pose_fin),
      duration_s: l.duree && l.duree >= 2 && l.duree <= 10 ? l.duree : 5,
      consent_confirmed: accord,
    })),
  );
  if (error) retour(projectId, "?erreur=import");
  await Promise.all([
    journaliser(supabase, profile.id, "import", "plan", null, { project_id: projectId, nombre: lignes.length, source: "tableau" }),
    marquerEnProduction(supabase, projectId),
  ]);
  retour(projectId, `?importe=${Math.min(lignes.length, 300)}`);
}


export type LigneCorrection = {
  numero: number;
  photoARefaire: boolean;
  duree: number | null;
  intention: string;
  cadrage: string;
  angle: string;
  lieu: string;
  pose_debut: string;
  pose_fin: string;
  description: string;
  mouvement: string;
};

// Tableau corrigé rendu par la vérification (ChatGPT, Claude…) : met à jour les plans existants, repérés par leur
// numéro dans l'ordre du tableau. Les répliques ne sont jamais modifiées ; une cellule vide garde la valeur actuelle.
export async function corrigerPlans(projectId: string, lignes: LigneCorrection[]) {
  const { supabase, profile } = await requireProfile();
  const { data: scenes } = await supabase
    .from("scenes")
    .select("id, duration_s, intention, cadrage, angle, lieu, pose_debut, pose_fin, image_description, motion_prompt, image_path")
    .eq("project_id", projectId)
    .order("position");
  if (!scenes?.length) retour(projectId, "?erreur=correction");

  const court = (t: string, n = 300) => String(t ?? "").trim().slice(0, n);
  const changements: { id: string; maj: Record<string, string | number> }[] = [];
  const photos: number[] = [];
  for (const l of lignes) {
    const s = scenes[l.numero - 1];
    if (!s) continue;
    const proposes: Record<string, string | number> = {
      intention: court(l.intention),
      cadrage: court(l.cadrage),
      angle: court(l.angle),
      lieu: court(l.lieu),
      pose_debut: court(l.pose_debut),
      pose_fin: court(l.pose_fin),
      image_description: court(l.description, 2000),
      motion_prompt: court(l.mouvement, 2000),
    };
    if (l.duree && l.duree >= 2 && l.duree <= 10) proposes.duration_s = l.duree;
    const maj = Object.fromEntries(
      Object.entries(proposes).filter(([k, v]) => v !== "" && v !== (s as Record<string, unknown>)[k]),
    );
    if (Object.keys(maj).length) changements.push({ id: s.id, maj });
    if (l.photoARefaire && s.image_path) photos.push(l.numero);
  }
  const resultats = await Promise.all(changements.map((c) => supabase.from("scenes").update(c.maj).eq("id", c.id)));
  if (resultats.some((r) => r.error)) retour(projectId, "?erreur=correction");
  await journaliser(supabase, profile.id, "correction", "plan", null, { project_id: projectId, nombre: changements.length });
  retour(projectId, `?corriges=${changements.length}${photos.length ? `&refaire=${photos.join(",")}` : ""}`);
}
