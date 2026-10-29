import "server-only";
import { cache } from "react";
import { getClient } from "@/lib/session";

// Deux façons de générer une vidéo avec le modèle Wan 2.2 (image → vidéo) :
// - « qualite » : le service tout prêt de RunPod (Public Endpoint), 720p, environ 0,30 $ le clip de 5 s ;
// - « eco-480 » / « eco-720 » : notre propre serveur RunPod (dossier worker/), même modèle en version
//   rapide (4 étapes), facturé à la seconde de GPU. Disponible dès que le serveur est créé
//   (bouton dans « Équipe et budget », identifiant gardé dans la table reglages).
const PUBLIC = "https://api.runpod.ai/v2/wan-2-2-i2v-720";

export type Moteur = "qualite" | "eco-480" | "eco-720";

// Prix estimés d'un clip de 5 s, comptés tout de suite pour que le plafond du mois bloque à temps.
// Pour notre serveur, le coût réel est recalculé ensuite à partir du temps de GPU.
export const MOTEURS: Record<Moteur, { libelle: string; prix5s: number }> = {
  "eco-480": { libelle: "Économique 480p", prix5s: 0.05 },
  "eco-720": { libelle: "Économique 720p", prix5s: 0.12 },
  qualite: { libelle: "Qualité max 720p", prix5s: 0.3 },
};

export const PRIX_ESTIME_5S_USD = MOTEURS.qualite.prix5s;

// Prix d'une seconde de GPU sur notre serveur (80 Go, A100 par défaut), à ajuster si on change de carte
// Tarif d'une H100 80 Go (la plus chère des cartes autorisées) : l'estimation par clip reste prudente
const PRIX_SECONDE_GPU = Number(process.env.RUNPOD_PRIX_SECONDE ?? 0.00116);

export const CLE_ENDPOINT = "runpod_endpoint_id";
export const CLE_VOLUME = "runpod_volume";
// Serveur dédié aux photos de départ (Qwen-Image-Edit en cache). Sans lui, les photos passent par le serveur vidéo.
export const CLE_ENDPOINT_PHOTO = "runpod_endpoint_photo";

// Identifiant de notre serveur RunPod (lu une fois par affichage)
export const endpointEco = cache(async (): Promise<string | null> => {
  if (process.env.RUNPOD_ENDPOINT_ID) return process.env.RUNPOD_ENDPOINT_ID;
  const supabase = await getClient();
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", CLE_ENDPOINT).maybeSingle();
  return data?.valeur || null;
});

// Serveur du studio voix (dossier worker-voix/), sur une petite carte graphique
export const CLE_ENDPOINT_VOIX = "runpod_endpoint_voix";
export const endpointVoix = cache(async (): Promise<string | null> => {
  const supabase = await getClient();
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", CLE_ENDPOINT_VOIX).maybeSingle();
  return data?.valeur || null;
});

export const endpointPhoto = cache(async (): Promise<string | null> => {
  const supabase = await getClient();
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", CLE_ENDPOINT_PHOTO).maybeSingle();
  return data?.valeur || (await endpointEco());
});

export async function moteursDisponibles(): Promise<Moteur[]> {
  return (await endpointEco()) ? ["eco-480", "eco-720", "qualite"] : ["qualite"];
}

export async function moteurParDefaut(): Promise<Moteur> {
  return (await moteursDisponibles())[0];
}

export function estMoteur(valeur: unknown): valeur is Moteur {
  return typeof valeur === "string" && valeur in MOTEURS;
}

const TAILLES: Record<string, string> = {
  "16:9": "1280*720",
  "9:16": "720*1280",
  "1:1": "960*960",
};

// Le modèle comprend surtout l'anglais
export const PROMPT_NEGATIF =
  "blurry, distorted, text, watermark, deformed face, deformed hands, extra fingers, static frame, oversaturated, low quality";

export function cle() {
  const k = process.env.RUNPOD_API_KEY;
  if (!k) throw new Error("La clé RunPod n'est pas encore configurée (RUNPOD_API_KEY dans Cloudflare).");
  return k;
}

// « photo » : notre serveur des photos de départ ; « voix » : celui du studio voix
type Cible = Moteur | "photo" | "voix";

// « serveur » : identifiant déjà lu, pour ne pas relire la base à chaque appel (Cloudflare limite le nombre
// d'appels extérieurs par requête)
async function base(moteur: Cible, serveur?: string) {
  if (moteur === "qualite") return PUBLIC;
  const id = serveur ?? (moteur === "photo" ? await endpointPhoto() : moteur === "voix" ? await endpointVoix() : await endpointEco());
  if (!id)
    throw new Error(
      moteur === "voix"
        ? "Le serveur voix n'est pas encore créé (voir « Équipe et budget »)."
        : "Notre serveur RunPod n'est pas encore créé (voir « Équipe et budget »).",
    );
  return `https://api.runpod.ai/v2/${encodeURIComponent(id)}`;
}

async function appel(moteur: Cible, chemin: string, init?: RequestInit, serveur?: string) {
  const res = await fetch(`${await base(moteur, serveur)}${chemin}`, {
    ...init,
    headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
  });
  const texte = await res.text();
  if (!res.ok) throw new Error(`RunPod a répondu ${res.status} : ${texte.slice(0, 200)}`);
  return JSON.parse(texte);
}

export async function lancerGeneration(p: {
  moteur: Moteur;
  prompt: string;
  imageUrl: string;
  format: string;
  duree: number;
  seed: number;
  // Notre serveur dépose lui-même la vidéo dans le stockage, à ce chemin, grâce à ce lien d'envoi
  videoPath: string;
  uploadUrl: string;
  // Plan continu : notre serveur dépose aussi la dernière image du clip, photo de départ du clip suivant
  dernierePhoto?: { chemin: string; uploadUrl: string };
  serveur?: string;
}): Promise<string> {
  const input =
    p.moteur === "qualite"
      ? {
          prompt: p.prompt,
          image: p.imageUrl,
          negative_prompt: PROMPT_NEGATIF,
          size: TAILLES[p.format] ?? TAILLES["16:9"],
          duration: p.duree,
          num_inference_steps: 30,
          guidance: 5,
          flow_shift: 5,
          seed: p.seed,
          enable_prompt_optimization: false,
          enable_safety_checker: true,
        }
      : {
          prompt: p.prompt,
          image_url: p.imageUrl,
          negative_prompt: PROMPT_NEGATIF,
          resolution: p.moteur === "eco-720" ? "720p" : "480p",
          format: p.format,
          duration: p.duree,
          seed: p.seed,
          video_path: p.videoPath,
          upload_url: p.uploadUrl,
          ...(p.dernierePhoto ? { last_frame_path: p.dernierePhoto.chemin, last_frame_upload_url: p.dernierePhoto.uploadUrl } : {}),
        };
  const data = await appel(p.moteur, "/run", { method: "POST", body: JSON.stringify({ input }) }, p.serveur);
  return String(data.id);
}

// Photo de départ créée par Qwen-Image-Edit sur notre serveur (métier « image »), à partir de 1 à 3 références.
// Estimation prudente, recalculée ensuite à partir du temps de GPU.
export const PRIX_PHOTO_ESTIME_USD = 0.02;

export async function lancerPhotoRunPod(p: {
  prompt: string;
  referenceUrls: string[];
  format: string;
  seed: number;
  imagePath: string;
  uploadUrl: string;
  serveur?: string;
}): Promise<string> {
  const input = {
    mode: "image",
    prompt: p.prompt,
    reference_urls: p.referenceUrls,
    format: p.format,
    seed: p.seed,
    image_path: p.imagePath,
    upload_url: p.uploadUrl,
  };
  const data = await appel("photo", "/run", { method: "POST", body: JSON.stringify({ input }) }, p.serveur);
  return String(data.id);
}

// Voix (texte → voix, ou enregistrement transformé) sur le serveur voix. Une carte de 16 à 24 Go suffit :
// prix d'une seconde de GPU estimé au plus cher de ces cartes, recalculé ensuite à partir du temps réel.
export const PRIX_SECONDE_VOIX = Number(process.env.RUNPOD_PRIX_SECONDE_VOIX ?? 0.00031);
export const PRIX_VOIX_ESTIME_USD = 0.01;

export async function lancerVoixRunPod(input: {
  moteur: "mms" | "kokoro" | "chatterbox" | "conversion";
  modele: string;
  texte: string;
  emotion: number;
  seed: number;
  referenceUrl?: string;
  sourceUrl?: string;
  audioPath: string;
  uploadUrl: string;
}): Promise<string> {
  const data = await appel("voix", "/run", {
    method: "POST",
    body: JSON.stringify({
      input: {
        moteur: input.moteur,
        modele: input.modele,
        texte: input.texte,
        emotion: input.emotion,
        seed: input.seed,
        reference_url: input.referenceUrl,
        source_url: input.sourceUrl,
        audio_path: input.audioPath,
        upload_url: input.uploadUrl,
      },
    }),
  });
  return String(data.id);
}

export type StatutRunPod =
  // « enFile » : RunPod ne l'a pas encore commencée (on peut l'annuler sans rien perdre)
  | { etat: "en_cours"; enFile: boolean }
  | {
      etat: "terminee";
      // Service tout prêt : vidéo à télécharger. Notre serveur : vidéo déjà rangée dans le stockage.
      videoUrl?: string;
      videoPath?: string;
      // Dernière image du clip, déposée par notre serveur quand elle a été demandée
      dernierePhoto?: string;
      imagePath?: string;
      audioPath?: string;
      duree?: number;
      coutUsd: number | null;
      secondes: number | null;
    }
  // « annulee » : arrêtée chez RunPod (bouton Pause, arrêt du serveur, ou annulation depuis la console)
  | { etat: "echouee"; erreur: string; annulee?: boolean };

export async function lireStatut(moteur: Cible, jobId: string, serveur?: string): Promise<StatutRunPod> {
  const data = await appel(moteur, `/status/${encodeURIComponent(jobId)}`, undefined, serveur);
  switch (data.status) {
    case "COMPLETED": {
      const secondes = typeof data.executionTime === "number" ? data.executionTime / 1000 : null;
      if (data.output?.error) return { etat: "echouee", erreur: String(data.output.error).slice(0, 500) };
      if (moteur !== "qualite") {
        const prix = moteur === "voix" ? PRIX_SECONDE_VOIX : PRIX_SECONDE_GPU;
        const coutUsd = secondes !== null ? Math.round(secondes * prix * 10000) / 10000 : null;
        if (data.output?.audio_path)
          return { etat: "terminee", audioPath: String(data.output.audio_path), duree: Number(data.output.duree) || undefined, secondes, coutUsd };
        if (data.output?.image_path) return { etat: "terminee", imagePath: String(data.output.image_path), secondes, coutUsd };
        if (!data.output?.video_path) return { etat: "echouee", erreur: "Le serveur n'a pas renvoyé de vidéo." };
        return {
          etat: "terminee",
          videoPath: String(data.output.video_path),
          ...(data.output.last_frame_path ? { dernierePhoto: String(data.output.last_frame_path) } : {}),
          secondes,
          coutUsd,
        };
      }
      const url = data.output?.video_url ?? data.output?.result ?? data.output?.url;
      if (!url) return { etat: "echouee", erreur: "RunPod n'a pas renvoyé de vidéo." };
      const cout = Number(data.output?.cost);
      return { etat: "terminee", videoUrl: String(url), coutUsd: Number.isFinite(cout) ? cout : null, secondes };
    }
    case "CANCELLED":
      return { etat: "echouee", erreur: "Annulée chez RunPod.", annulee: true };
    case "FAILED":
    case "TIMED_OUT":
      return { etat: "echouee", erreur: String(data.error ?? data.status).slice(0, 500) };
    default:
      return { etat: "en_cours", enFile: data.status === "IN_QUEUE" };
  }
}

export async function annulerJob(moteur: Cible, jobId: string, serveur?: string) {
  await appel(moteur, `/cancel/${encodeURIComponent(jobId)}`, { method: "POST" }, serveur).catch(() => undefined);
}
