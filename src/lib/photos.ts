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

// Prompts des photos de départ, pour les créer ailleurs (ChatGPT, ordinateur avec carte graphique…), par lots de 10 :
// au-delà, ChatGPT oublie les consignes ou mélange les plans. Chaque image s'appelle plan_NN.png et les 10 images
// reviennent dans un fichier ZIP, réimporté d'un coup dans le bon plan.
export const TAILLE_LOT = 10;

export function lotsPromptsPhotos(
  plans: (FichePlan & { numero: number })[],
  projet: { aspect_ratio: string; style_text: string },
  refs: Reference[],
) {
  const avec = plans.filter((p) => p.description.trim());
  const nom = (n: number) => `plan_${String(n).padStart(2, "0")}.png`;
  const lots: { debut: number; fin: number; texte: string }[] = [];
  for (let k = 0; k < avec.length; k += TAILLE_LOT) {
    const lot = avec.slice(k, k + TAILLE_LOT);
    const debut = lot[0].numero;
    const fin = lot[lot.length - 1].numero;
    const zip = `photos_plans_${String(debut).padStart(2, "0")}-${String(fin).padStart(2, "0")}.zip`;
    const citees = [...new Set(lot.flatMap((p) => referencesCitees(`${p.description} ${p.lieu ?? ""}`, refs)).map((r) => r.nom))];
    const entete = `Tu es directeur de la photographie et retoucheur pour un film. Crée les photos de départ des plans ${debut} à ${fin} (lot ${k / TAILLE_LOT + 1} sur ${Math.ceil(avec.length / TAILLE_LOT)}), une image par plan, dans l'ordre.

AVANT DE COMMENCER
- Je te joins les photos de référence : ${citees.join(", ") || "aucune"}. Garde exactement les mêmes visages, âges, coiffures, tenues et décors sur toutes les images. Si une photo citée manque, dis-le en une ligne et attends-la.
- Ne me pose pas d'autre question : commence tout de suite.

POUR CHAQUE IMAGE
- Format ${projet.aspect_ratio}, une seule photo réaliste qui remplit tout le cadre : pas de planche, pas de grille, pas de texte, pas de bordure.
- Suis le prompt du plan à la lettre (cadrage, angle, lieu, pose de départ, lumière).
- Nom du fichier : celui indiqué au-dessus du prompt (${nom(debut)}, …), sans le changer.

À LA FIN DU LOT
- Mets les ${lot.length} images dans un seul fichier ZIP nommé ${zip} et donne-moi le lien pour le télécharger.
- Si tu ne peux pas faire de ZIP, donne chaque image séparément avec son nom exact.
- Termine par la liste des plans faits et, s'il y en a, ceux à refaire et pourquoi (visage différent, mains, texte dans l'image).`;
    lots.push({
      debut,
      fin,
      texte: [
        entete,
        ...lot.map(
          (p) =>
            `=== ${nom(p.numero)} ===\n${promptPhoto({
              ...p,
              total: plans.length,
              format: projet.aspect_ratio,
              style: projet.style_text,
              refs: referencesCitees(`${p.description} ${p.lieu ?? ""}`, refs),
            })}`,
        ),
      ].join("\n\n"),
    });
  }
  return lots;
}

// Tous les lots à la suite (outil d'images sur l'ordinateur)
export function promptsPhotos(...args: Parameters<typeof lotsPromptsPhotos>) {
  return lotsPromptsPhotos(...args)
    .map((l) => l.texte)
    .join("\n\n");
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
      const statut = await lireStatut("photo", p.runpod_job_id).catch(() => null);
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
