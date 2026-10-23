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

export function promptPhoto(p: {
  description: string;
  numero: number;
  total: number;
  format: string;
  style: string;
  refs: Reference[];
}) {
  const images = p.refs
    .map((r, i) => `image ${i + 1} = ${r.nom} (${(GENRES[r.genre] ?? r.genre).toLowerCase()}${r.description ? ` : ${r.description}` : ""})`)
    .join(" ; ");
  return [
    `Photo de film réaliste, plan ${p.numero} sur ${p.total}, format ${p.format}.`,
    `Scène : ${p.description.trim()}`,
    `Images de référence : ${images}.`,
    "Garder exactement le visage, la coiffure, la morphologie et les vêtements des personnages des images de référence, et le décor des lieux de référence.",
    p.style.trim() ? `Style du film : ${p.style.trim()}.` : "",
    "Cadrage et lumière de cinéma, une seule scène, aucune écriture, aucun logo, aucun filigrane.",
  ]
    .filter(Boolean)
    .join("\n");
}

// Lance la création de la photo d'un plan. Renvoie un code d'erreur, ou null si c'est parti.
export async function lancerPhoto(
  supabase: SupabaseClient,
  auteurId: string,
  projet: { id: string; aspect_ratio: string; style_text: string },
  plan: { id: string; image_description: string; numero: number },
  total: number,
  refs: Reference[],
) {
  if (!plan.image_description.trim()) return "sans-description";
  const choisies = referencesCitees(plan.image_description, refs);
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
