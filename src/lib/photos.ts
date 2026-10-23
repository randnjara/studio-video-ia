import type { SupabaseClient } from "@supabase/supabase-js";
import { GENRES } from "@/lib/libelles";
import { BUCKET } from "@/lib/production";
import { PRIX_PHOTO_ESTIME_USD, lancerPhotoRunPod, lireStatut } from "@/lib/runpod";

// Photos de départ créées par Qwen-Image-Edit à partir des « références du film » (personnages, lieux, objets, style).
// Une référence est utilisée quand son nom est cité dans la description de la photo du plan.

export type Reference = { id: string; nom: string; genre: string; description: string; image_path: string };


const MAX_REFERENCES = 3; // Qwen-Image-Edit garde bien les détails jusqu'à 3 images
const ORDRE_GENRES = ["personnage", "lieu", "objet", "style"];

const normaliser = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Références citées dans la description, personnages d'abord, sans dépasser 3 images
export function referencesCitees(description: string, refs: Reference[]) {
  const texte = ` ${normaliser(description).replace(/[^a-z0-9]+/g, " ")} `;
  return refs
    .filter((r) => {
      const nom = normaliser(r.nom).replace(/[^a-z0-9]+/g, " ").trim();
      return nom.length > 0 && texte.includes(` ${nom} `);
    })
    .sort((a, b) => ORDRE_GENRES.indexOf(a.genre) - ORDRE_GENRES.indexOf(b.genre))
    .slice(0, MAX_REFERENCES);
}

export type FichePlan = {
  description: string;
  cadrage?: string;
  angle?: string;
  lieu?: string;
  intention?: string;
  pose_debut?: string;
};

// Consigne envoyée à Qwen-Image-Edit, qui comprend mieux l'anglais : les parties fixes sont en anglais,
// les textes de la personne (souvent en français) sont repris tels quels.
// Les règles fixes viennent des erreurs vues sur le Projet Mama (planches, texte, mains, visage qui change).
export function promptPhoto(p: FichePlan & { numero: number; total: number; format: string; style: string; refs: Reference[] }) {
  const images = p.refs
    .map((r, i) => `image ${i + 1} = ${r.nom} (${r.genre}${r.description ? `: ${r.description}` : ""})`)
    .join("; ");
  const fiche = [
    p.cadrage && `shot size: ${p.cadrage}`,
    p.angle && `camera angle: ${p.angle}`,
    p.lieu && `location: ${p.lieu}`,
    p.intention && `emotion: ${p.intention}`,
    p.pose_debut && `starting pose: ${p.pose_debut}`,
  ].filter(Boolean);
  return [
    `Photorealistic cinematic film still, shot ${p.numero} of ${p.total}, ${p.format} frame.`,
    `Scene: ${p.description.trim()}`,
    fiche.length ? `Shot sheet: ${fiche.join("; ")}.` : "",
    `Reference images: ${images}.`,
    "Keep exactly the same person as the reference images: same face, facial proportions, apparent age, wrinkles, skin tone, hairstyle, body shape and clothing. Do not beautify, rejuvenate or reshape the face. Keep the reference locations unchanged.",
    p.style.trim() ? `Film style: ${p.style.trim()}.` : "",
    "One single natural photographic moment that can be the first frame of a five-second video. Full-frame image filling the whole format: no collage, no storyboard sheet, no grid, no split screen, no blurred side bars, no border, no text, no caption, no logo, no watermark.",
    "Natural anatomy: exactly two arms and two hands, five fingers per hand, realistic contact with objects. Cinematic lighting, realistic depth of field, natural skin texture.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Prompts de toutes les photos de départ, pour les créer ailleurs (ChatGPT, ordinateur avec carte graphique…).
// Chaque image doit être enregistrée sous plan_NN.png pour être réimportée d'un coup dans le bon plan.
export function promptsPhotos(
  plans: (FichePlan & { numero: number })[],
  projet: { aspect_ratio: string; style_text: string },
  refs: Reference[],
) {
  const avec = plans.filter((p) => p.description.trim());
  const nom = (n: number) => `plan_${String(n).padStart(2, "0")}.png`;
  const entete = `Crée une image par plan ci-dessous, une à la fois, au format ${projet.aspect_ratio}. Je te joins les photos de référence citées (${refs.map((r) => r.nom).join(", ") || "aucune"}) : garde exactement les mêmes visages, tenues et décors.
Enregistre chaque image sous le nom indiqué (${nom(avec[0]?.numero ?? 1)}, …) : je les réimporterai toutes d'un coup dans mon studio.`;
  return [
    entete,
    ...avec.map(
      (p) =>
        `=== ${nom(p.numero)} ===\n${promptPhoto({
          ...p,
          total: plans.length,
          format: projet.aspect_ratio,
          style: projet.style_text,
          refs: referencesCitees(`${p.description} ${p.lieu ?? ""}`, refs),
        })}`,
    ),
  ].join("\n\n");
}

// Lance la création de la photo d'un plan. Renvoie un code d'erreur, ou null si c'est parti.
export async function lancerPhoto(
  supabase: SupabaseClient,
  auteurId: string,
  projet: { id: string; aspect_ratio: string; style_text: string },
  plan: { id: string; image_description: string; numero: number; cadrage?: string; angle?: string; lieu?: string; intention?: string; pose_debut?: string },
  total: number,
  refs: Reference[],
) {
  if (!plan.image_description.trim()) return "sans-description";
  // Le lieu de la fiche compte comme une citation : la référence du lieu part avec la photo
  const choisies = referencesCitees(`${plan.image_description} ${plan.lieu ?? ""}`, refs);
  if (choisies.length === 0) return "sans-reference";

  const seed = Math.floor(Math.random() * 2_000_000_000);
  const { data: photo, error } = await supabase
    .from("photos")
    .insert({
      scene_id: plan.id,
      status: "en_cours",
      seed,
      ref_ids: choisies.map((r) => r.id),
      cost_usd: PRIX_PHOTO_ESTIME_USD,
      created_by: auteurId,
    })
    .select("id")
    .single();
  if (error || !photo) return error?.code === "P0001" ? "budget" : "photo";

  try {
    const imagePath = `${projet.id}/photos/genere-${photo.id}.jpg`;
    const [{ data: envoi, error: errEnvoi }, { data: liens }] = await Promise.all([
      supabase.storage.from(BUCKET).createSignedUploadUrl(imagePath, { upsert: true }),
      supabase.storage.from(BUCKET).createSignedUrls(
        choisies.map((r) => r.image_path),
        60 * 60,
      ),
    ]);
    if (errEnvoi || !envoi) throw new Error(errEnvoi?.message ?? "lien d'envoi");
    const referenceUrls = choisies.map((r) => liens?.find((l) => l.path === r.image_path)?.signedUrl).filter(Boolean) as string[];
    if (referenceUrls.length === 0) throw new Error("Les images de référence sont introuvables.");

    const jobId = await lancerPhotoRunPod({
      prompt: promptPhoto({
        description: plan.image_description,
        cadrage: plan.cadrage,
        angle: plan.angle,
        lieu: plan.lieu,
        intention: plan.intention,
        pose_debut: plan.pose_debut,
        numero: plan.numero,
        total,
        format: projet.aspect_ratio,
        style: projet.style_text,
        refs: choisies,
      }),
      referenceUrls,
      format: projet.aspect_ratio,
      seed,
      imagePath,
      uploadUrl: envoi.signedUrl,
    });
    await supabase.from("photos").update({ runpod_job_id: jobId }).eq("id", photo.id);
    return null;
  } catch (e) {
    await supabase
      .from("photos")
      .update({ status: "echouee", error: (e instanceof Error ? e.message : String(e)).slice(0, 500), cost_usd: 0 })
      .eq("id", photo.id);
    return "photo";
  }
}

// Met à jour les photos en cours ; une photo réussie devient la photo de départ du plan
export async function suivrePhotos(
  supabase: SupabaseClient,
  projectId: string,
  photos: { id: string; scene_id: string; runpod_job_id: string | null }[],
) {
  await Promise.all(
    photos.map(async (p) => {
      if (!p.runpod_job_id) return;
      const statut = await lireStatut("eco-480", p.runpod_job_id).catch(() => null);
      if (!statut || statut.etat === "en_cours") return;
      const fin = new Date().toISOString();
      if (statut.etat === "echouee" || !statut.imagePath?.startsWith(`${projectId}/photos/`)) {
        const erreur = statut.etat === "echouee" ? statut.erreur : "Le serveur n'a pas renvoyé de photo.";
        await supabase.from("photos").update({ status: "echouee", error: erreur, cost_usd: 0, finished_at: fin }).eq("id", p.id);
        return;
      }
      await Promise.all([
        supabase
          .from("photos")
          .update({
            status: "terminee",
            image_path: statut.imagePath,
            gpu_seconds: statut.secondes,
            finished_at: fin,
            ...(statut.coutUsd !== null ? { cost_usd: statut.coutUsd } : {}),
          })
          .eq("id", p.id),
        supabase.from("scenes").update({ image_path: statut.imagePath }).eq("id", p.scene_id),
      ]);
    }),
  );
}
