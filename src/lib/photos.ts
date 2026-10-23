import type { SupabaseClient } from "@supabase/supabase-js";
import { GENRES } from "@/lib/libelles";
import { type EtatFile, attente, lireEtatFile } from "@/lib/file-attente";
import { ANNULATIONS_PAR_APPEL, BUCKET, aSuivre } from "@/lib/production";
import { PRIX_PHOTO_ESTIME_USD, annulerJob, lancerPhotoRunPod, lireStatut } from "@/lib/runpod";

// Photos de départ créées par Qwen-Image-Edit à partir des « références du film » (personnages, lieux, objets, style).
// Une référence est utilisée quand son nom est cité dans la description de la photo du plan.

export type Reference = { id: string; nom: string; genre: string; description: string; image_path: string };


const MAX_REFERENCES = 3; // Qwen-Image-Edit garde bien les détails jusqu'à 3 images
const ORDRE_GENRES = ["personnage", "lieu", "produit", "objet", "style"];

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

// Remarques laissées avec « Re-générer » : ce qui n'allait pas sur la photo précédente et ce que l'on veut
export type Remarques = { a_eviter?: string; voulu?: string };

// Consigne envoyée à Qwen-Image-Edit, qui comprend mieux l'anglais : les parties fixes sont en anglais,
// les textes de la personne (souvent en français) sont repris tels quels.
// Les règles fixes viennent des erreurs vues sur le Projet Mama (planches, texte, mains, visage qui change).
export function promptPhoto(
  p: FichePlan & Remarques & { numero: number; total: number; format: string; style: string; refs: Reference[] },
) {
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
    // Placées juste après la scène pour peser plus lourd. Le serveur n'utilise pas le prompt négatif (true_cfg_scale 1) :
    // ce qu'il faut éviter est donc écrit dans le prompt lui-même.
    p.voulu?.trim() ? `Correction requested after a previous failed attempt (top priority, apply it exactly): ${p.voulu.trim()}` : "",
    p.a_eviter?.trim() ? `Problems of the previous attempt that must NOT appear again: ${p.a_eviter.trim()}` : "",
    `Reference images: ${images}.`,
    "Keep exactly the same person as the reference images: same face, facial proportions, apparent age, wrinkles, skin tone, hairstyle, body shape and clothing. Do not beautify, rejuvenate or reshape the face. Keep the reference locations unchanged.",
    ...p.refs
      .filter((r) => r.genre === "produit")
      .slice(0, 1)
      .map(
        (r) =>
          `The product ${r.nom} must look exactly like its reference images: same shape, proportions, colours, materials, buttons, logo and printed label; clearly visible and sharp.`,
      ),
    p.style.trim() ? `Film style: ${p.style.trim()}.` : "",
    "One single natural photographic moment that can be the first frame of a five-second video. Full-frame image filling the whole format: no collage, no storyboard sheet, no grid, no split screen, no blurred side bars, no border, no added text, no caption, no extra logo, no watermark (only the product's own label if a product is shown).",
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
- Un même lieu = exactement la même pièce sur toutes les images (murs, meubles, objets à la même place, même lumière) : seuls le cadrage, l'angle et la pose changent. Si une photo du lieu est jointe, recopie ce décor.
- Un produit à promouvoir = exactement le même objet que sur ses photos (forme, couleurs, boutons, logo et étiquette), bien visible et net.
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

// Les photos partent par une file d'attente : Cloudflare limite le nombre d'appels extérieurs par requête (50),
// et un lot de 10 photos lancé d'un coup le dépassait (photos coupées au départ). La demande ne fait qu'inscrire
// les photos (sans numéro RunPod) ; chaque actualisation de la page en envoie quelques-unes et suit les autres.
const ENVOIS_PAR_APPEL = 4;
const SUIVIS_PAR_APPEL = 6;
// Numéro provisoire pendant l'envoi : une seule requête peut prendre une photo en attente
const ENVOI = "envoi";
const ENVOI_MAX_MS = 3 * 60 * 1000;
const ATTENTE_MAX_MS = 60 * 60 * 1000;

// Inscrit les photos des plans dans la file, en un seul appel. Renvoie le nombre inscrit et ceux sans référence.
export async function demanderPhotos(
  supabase: SupabaseClient,
  auteurId: string,
  plans: { id: string; image_description: string; lieu?: string | null }[],
  refs: Reference[],
  remarques: Remarques = {},
): Promise<{ inscrites: number; sansReference: number; erreur: "budget" | "photo" | null }> {
  const lignes = plans.flatMap((plan) => {
    if (!plan.image_description.trim()) return [];
    // Le lieu de la fiche compte comme une citation : la référence du lieu part avec la photo
    const choisies = referencesCitees(`${plan.image_description} ${plan.lieu ?? ""}`, refs);
    if (choisies.length === 0) return [];
    return [
      {
        scene_id: plan.id,
        status: "en_cours",
        seed: Math.floor(Math.random() * 2_000_000_000),
        ref_ids: choisies.map((r) => r.id),
        cost_usd: PRIX_PHOTO_ESTIME_USD,
        created_by: auteurId,
        // Seulement quand il y en a : une demande normale reste valable même si la colonne n'existe pas encore
        ...(remarques.a_eviter?.trim() ? { a_eviter: remarques.a_eviter.trim() } : {}),
        ...(remarques.voulu?.trim() ? { voulu: remarques.voulu.trim() } : {}),
      },
    ];
  });
  const sansReference = plans.filter((p) => p.image_description.trim()).length - lignes.length;
  if (lignes.length === 0) return { inscrites: 0, sansReference, erreur: null };
  const { error } = await supabase.from("photos").insert(lignes);
  if (error) return { inscrites: 0, sansReference, erreur: error.code === "P0001" ? "budget" : "photo" };
  return { inscrites: lignes.length, sansReference, erreur: null };
}

type PhotoSuivie = { id: string; scene_id: string; runpod_job_id: string | null; created_at: string };

const echec = (supabase: SupabaseClient, id: string, erreur: string) =>
  supabase
    .from("photos")
    .update({ status: "echouee", error: erreur, cost_usd: 0, finished_at: new Date().toISOString() })
    .eq("id", id);

// Envoie à RunPod les photos en attente du projet (quelques-unes par appel)
async function envoyerPhotos(supabase: SupabaseClient, projectId: string, enAttente: PhotoSuivie[], serveur: string) {
  const [{ data: projet }, { data: scenes }, { data: refs }] = await Promise.all([
    supabase.from("projects").select("id, aspect_ratio, style_text").eq("id", projectId).single(),
    supabase
      .from("scenes")
      .select("id, image_description, cadrage, angle, lieu, intention, pose_debut")
      .eq("project_id", projectId)
      .order("position"),
    supabase.from("film_refs").select("id, nom, genre, description, image_path").eq("project_id", projectId).order("created_at"),
  ]);
  if (!projet || !scenes) return;
  for (const photo of enAttente.slice(0, ENVOIS_PAR_APPEL)) {
    const { data: prise } = await supabase
      .from("photos")
      .update({ runpod_job_id: ENVOI })
      .eq("id", photo.id)
      .is("runpod_job_id", null)
      // Toutes les colonnes : les remarques (a_eviter, voulu) sont lues si elles existent dans la base
      .select("*")
      .maybeSingle();
    if (!prise) continue; // déjà prise par une autre actualisation
    const numero = scenes.findIndex((s) => s.id === photo.scene_id) + 1;
    const plan = scenes[numero - 1];
    const choisies = (refs ?? []).filter((r) => (prise.ref_ids as string[]).includes(r.id));
    try {
      if (!plan || choisies.length === 0) throw new Error("Le plan ou ses photos de référence ont été supprimés.");
      const imagePath = `${projectId}/photos/genere-${photo.id}.jpg`;
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
          cadrage: plan.cadrage ?? undefined,
          angle: plan.angle ?? undefined,
          lieu: plan.lieu ?? undefined,
          intention: plan.intention ?? undefined,
          pose_debut: plan.pose_debut ?? undefined,
          a_eviter: prise.a_eviter ?? undefined,
          voulu: prise.voulu ?? undefined,
          numero,
          total: scenes.length,
          format: projet.aspect_ratio,
          style: projet.style_text,
          refs: choisies,
        }),
        referenceUrls,
        format: projet.aspect_ratio,
        seed: Number(prise.seed),
        imagePath,
        uploadUrl: envoi.signedUrl,
        serveur,
      });
      const { data: gardee, error: errJob } = await supabase
        .from("photos")
        .update({ runpod_job_id: jobId })
        .eq("id", photo.id)
        .eq("status", "en_cours")
        .select("id");
      if (errJob) throw new Error(errJob.message);
      // Lot arrêté pendant l'envoi : la photo ne doit pas être calculée (et facturée) pour rien
      if (gardee?.length === 0) await annulerJob("photo", jobId, serveur);
    } catch (e) {
      await echec(supabase, photo.id, (e instanceof Error ? e.message : String(e)).slice(0, 500));
    }
  }
}

// Envoie les photos en attente puis met à jour celles en cours ; une photo réussie devient la photo de départ du plan.
// « envoyer » est faux pendant l'affichage de la page (déjà beaucoup d'appels) : l'envoi se fait par l'actualisation.
// En pause (ou serveur arrêté), rien ne part et les photos pas encore commencées reviennent dans la file.
export async function suivrePhotos(
  supabase: SupabaseClient,
  projectId: string,
  photos: PhotoSuivie[],
  envoyer = true,
  etatLu?: EtatFile,
) {
  if (photos.length === 0) return;
  // Serveur photo, sinon le serveur vidéo (lus une seule fois, avec la pause, en un appel)
  const etat = etatLu ?? (await lireEtatFile(supabase, projectId));
  const serveur = etat.serveurPhoto;
  if (!serveur) return;
  const bloque = etat.enPause || etat.serveurArrete;
  const age = (p: PhotoSuivie) => attente(etat, p.created_at);
  const enAttente = photos.filter((p) => !p.runpod_job_id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const parties = photos.filter((p) => p.runpod_job_id && p.runpod_job_id !== ENVOI);
  // Coupée pendant l'envoi : on ne sait pas si RunPod l'a reçue, elle passe en échec pour être relancée
  await Promise.all(
    photos
      .filter((p) => p.runpod_job_id === ENVOI && age(p) > ENVOI_MAX_MS)
      .map((p) => echec(supabase, p.id, "Le lancement a été interrompu. Relancez cette photo.")),
  );
  if (!bloque)
    await Promise.all(
      enAttente.filter((p) => age(p) > ATTENTE_MAX_MS).map((p) => echec(supabase, p.id, "Photo jamais envoyée (page fermée). Relancez-la.")),
    );
  if (envoyer && !bloque) await envoyerPhotos(supabase, projectId, enAttente.filter((p) => age(p) <= ATTENTE_MAX_MS), serveur);

  // Remet une photo dans notre file (sans numéro RunPod), si elle n'a pas changé entre-temps
  const remettreEnFile = (p: PhotoSuivie) =>
    supabase.from("photos").update({ runpod_job_id: null }).eq("id", p.id).eq("runpod_job_id", p.runpod_job_id!).eq("status", "en_cours");

  await Promise.all(
    aSuivre(parties, SUIVIS_PAR_APPEL, bloque).map(async (p) => {
      const statut = await lireStatut("photo", p.runpod_job_id!, serveur).catch(() => null);
      if (!statut) return;
      if (statut.etat === "en_cours") {
        // En pause : pas encore commencée chez RunPod, on la reprend pour qu'elle ne parte pas
        if (statut.enFile && bloque) {
          await annulerJob("photo", p.runpod_job_id!, serveur);
          await remettreEnFile(p);
        }
        return;
      }
      // Annulée par la pause ou l'arrêt du serveur : elle repartira à la reprise
      if (statut.etat === "echouee" && statut.annulee && bloque) {
        await remettreEnFile(p);
        return;
      }
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

// « Arrêter le lot » : annule chez RunPod les photos parties et retire de la file celles qui attendaient (non facturé).
// Les photos déjà réussies restent. Renvoie le nombre arrêté et celles à arrêter au clic suivant.
export async function arreterPhotos(supabase: SupabaseClient, projectId: string) {
  const [{ data }, etat] = await Promise.all([
    supabase
      .from("photos")
      .select("id, runpod_job_id, scenes!inner(project_id)")
      .eq("status", "en_cours")
      .eq("scenes.project_id", projectId),
    lireEtatFile(supabase, projectId),
  ]);
  const photos = data ?? [];
  const parties = photos.filter((p) => p.runpod_job_id && p.runpod_job_id !== ENVOI);
  const restants = parties.slice(ANNULATIONS_PAR_APPEL).map((p) => p.id);
  if (etat.serveurPhoto)
    await Promise.all(parties.slice(0, ANNULATIONS_PAR_APPEL).map((p) => annulerJob("photo", p.runpod_job_id!, etat.serveurPhoto!)));
  const arretees = photos.filter((p) => !restants.includes(p.id)).map((p) => p.id);
  if (arretees.length > 0)
    await supabase
      .from("photos")
      .update({ status: "echouee", error: "Arrêtée à la demande.", cost_usd: 0, finished_at: new Date().toISOString() })
      .in("id", arretees)
      .eq("status", "en_cours");
  return { arretes: arretees.length, restants: restants.length };
}
