import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cle } from "@/lib/runpod";

// Création de notre serveur de génération chez RunPod, avec la clé déjà enregistrée dans Cloudflare.
// L'image est construite par GitHub à chaque changement du dossier worker/ (.github/workflows/serveur-video.yml).
export const IMAGE_SERVEUR = "ghcr.io/randnjara/studio-video-ia-worker:latest";
// À augmenter avec worker/VERSION : le studio fait passer notre serveur sur cette image au prochain envoi
export const VERSION_SERVEUR = "3";
const CLE_IMAGE = "runpod_image";
const NOM = "studio-video-eco";

async function rest(chemin: string, init?: RequestInit) {
  const res = await fetch(`https://rest.runpod.io/v1${chemin}`, {
    ...init,
    headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
  });
  const texte = await res.text();
  if (!res.ok) throw new Error(`RunPod ${chemin} : ${res.status} ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : null;
}

// Les cartes de 80 Go (A100, H100) font tenir tout le modèle en mémoire
async function cartes80Go(): Promise<string[]> {
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { gpuTypes { id memoryInGb } }" }),
  });
  const data = (await res.json().catch(() => null)) as { data?: { gpuTypes?: { id: string; memoryInGb: number }[] } } | null;
  const ids = (data?.data?.gpuTypes ?? []).filter((g) => g.memoryInGb >= 80 && g.memoryInGb <= 96).map((g) => g.id);
  return ids.length > 0 ? ids : ["NVIDIA A100 80GB PCIe", "NVIDIA A100-SXM4-80GB", "NVIDIA H100 80GB HBM3", "NVIDIA H100 PCIe"];
}

// Le studio voix tient sur une petite carte (16 à 24 Go), bien moins chère
async function cartesVoix(): Promise<string[]> {
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { gpuTypes { id memoryInGb } }" }),
  });
  const data = (await res.json().catch(() => null)) as { data?: { gpuTypes?: { id: string; memoryInGb: number }[] } } | null;
  const ids = (data?.data?.gpuTypes ?? []).filter((g) => g.memoryInGb >= 16 && g.memoryInGb <= 24).map((g) => g.id);
  return ids.length > 0 ? ids : ["NVIDIA RTX A4000", "NVIDIA RTX A4500", "NVIDIA RTX A5000", "NVIDIA GeForce RTX 4090", "NVIDIA L4"];
}

export async function creerServeur(
  nom = NOM,
  nomModele = NOM,
  image = IMAGE_SERVEUR,
  options: { cartes?: string[]; disqueGo?: number; maxMachines?: number } = {},
): Promise<string> {
  // Réutilise le modèle de serveur s'il existe déjà (par exemple après un premier essai interrompu)
  const modeles = ((await rest("/templates").catch(() => [])) ?? []) as { id: string; name: string }[];
  let modele = modeles.find((m) => m.name === nomModele);
  if (!modele) {
    modele = await rest("/templates", {
      method: "POST",
      body: JSON.stringify({
        name: nomModele,
        imageName: image,
        isServerless: true,
        containerDiskInGb: options.disqueGo ?? 150,
        env: {},
      }),
    });
  }
  if (!modele?.id) throw new Error("RunPod n'a pas renvoyé de modèle de serveur.");

  const existants = ((await rest("/endpoints").catch(() => [])) ?? []) as { id: string; name: string }[];
  const existant = existants.find((e) => e.name === nom);
  if (existant) return existant.id;

  const endpoint = await rest("/endpoints", {
    method: "POST",
    body: JSON.stringify({
      name: nom,
      templateId: modele.id,
      gpuTypeIds: options.cartes ?? (await cartes80Go()),
      gpuCount: 1,
      workersMin: 0, // rien n'est payé quand rien ne tourne
      workersMax: options.maxMachines ?? 2,
      idleTimeout: 30, // garde le serveur 30 s après un clip, pour enchaîner une série sans redémarrer
      executionTimeoutMs: 900_000,
      scalerType: "QUEUE_DELAY",
      scalerValue: 4,
      flashboot: true,
    }),
  });
  if (!endpoint?.id) throw new Error("RunPod n'a pas renvoyé d'identifiant de serveur.");
  return String(endpoint.id);
}

// Serveur du studio voix (dossier worker-voix/) : sa propre image, construite par GitHub
// (.github/workflows/serveur-voix.yml). À augmenter avec worker-voix/VERSION.
export const VERSION_SERVEUR_VOIX = "1";
const IMAGE_VOIX = `ghcr.io/randnjara/studio-video-ia-voix:v${VERSION_SERVEUR_VOIX}`;
const NOM_VOIX = "studio-voix";

export async function creerServeurVoix(): Promise<string> {
  // Les modèles de voix sont déjà dans l'image : un petit disque suffit
  return creerServeur(NOM_VOIX, NOM_VOIX, IMAGE_VOIX, { cartes: await cartesVoix(), disqueGo: 30, maxMachines: 1 });
}

export async function mettreAJourServeurVoix(supabase: SupabaseClient, endpointId: string) {
  const cleImage = `${CLE_IMAGE}:${endpointId}`;
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", cleImage).maybeSingle();
  if (data?.valeur === IMAGE_VOIX) return;
  await v2(`/v2/serverless/${encodeURIComponent(endpointId)}`, {
    method: "PATCH",
    body: JSON.stringify({ image: IMAGE_VOIX }),
  });
  await supabase.from("reglages").upsert({ cle: cleImage, valeur: IMAGE_VOIX });
}

// Stockage du modèle chez RunPod (« network volume ») : le modèle reste sur ce disque entre deux pauses,
// au lieu d'être retéléchargé à chaque démarrage. Le serveur ne tourne alors que dans le centre de ce disque.
const NOM_VOLUME = "studio-video-modele";
// Wan 2.2 en version allégée (≈ 70 Go) + Qwen-Image-Edit pour les photos de départ (≈ 60 Go), avec de la marge
export const TAILLE_VOLUME_GO = 150;
export const PRIX_VOLUME_MOIS_USD = Math.round(TAILLE_VOLUME_GO * 0.07 * 100) / 100;
const NIVEAUX: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

async function v2(chemin: string, init?: RequestInit) {
  const res = await fetch(`https://api.runpod.io${chemin}`, {
    ...init,
    headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
  });
  const texte = await res.text();
  if (!res.ok) throw new Error(`RunPod ${chemin} : ${res.status} ${texte.slice(0, 300)}`);
  return texte ? JSON.parse(texte) : null;
}

type Centre = {
  id: string;
  region: string;
  networkVolumeTypes: string[];
  gpuAvailability?: { id: string; availability: string }[];
};

// Choisit le centre qui a le plus de cartes de 80 Go disponibles, en préférant l'Europe à égalité
async function meilleurCentre(): Promise<string> {
  const cartes = new Set(await cartes80Go());
  const { dataCenters = [] } = ((await v2("/v2/catalog/datacenters?include=GPU_AVAILABILITY")) ?? {}) as {
    dataCenters?: Centre[];
  };
  const notes = dataCenters
    .filter((c) => c.networkVolumeTypes.length > 0)
    .map((c) => ({
      id: c.id,
      note:
        (c.gpuAvailability ?? []).reduce((s, g) => s + (cartes.has(g.id) ? (NIVEAUX[g.availability] ?? 0) : 0), 0) +
        (c.region === "EUROPE" ? 0.5 : 0),
    }))
    .filter((c) => c.note >= 1)
    .sort((a, b) => b.note - a.note);
  if (notes.length === 0) throw new Error("Aucun centre RunPod n'a de carte de 80 Go disponible en ce moment.");
  return notes[0].id;
}

export async function ajouterStockage(endpointId: string): Promise<{ id: string; centre: string }> {
  const { networkVolumes = [] } = ((await v2("/v2/network-volumes")) ?? {}) as {
    networkVolumes?: { id: string; name: string; dataCenter: string }[];
  };
  let volume = networkVolumes.find((v) => v.name === NOM_VOLUME);
  if (volume) await agrandirStockage();
  else {
    volume = await v2("/v2/network-volumes", {
      method: "POST",
      body: JSON.stringify({ name: NOM_VOLUME, size: TAILLE_VOLUME_GO, dataCenter: await meilleurCentre() }),
    });
  }
  if (!volume?.id) throw new Error("RunPod n'a pas renvoyé de disque.");

  await v2(`/v2/serverless/${endpointId}`, {
    method: "PATCH",
    body: JSON.stringify({
      mounts: { network: [{ volumeId: volume.id }] },
      dataCenterIds: [volume.dataCenter],
      timeout: 1_800_000, // le tout premier clip copie le modèle sur le disque : on lui laisse 30 min
    }),
  });
  return { id: volume.id, centre: volume.dataCenter };
}

// Agrandit le disque s'il a été créé plus petit (avant l'ajout des photos de départ). Le disque ne peut que grandir.
export async function agrandirStockage() {
  const { networkVolumes = [] } = ((await v2("/v2/network-volumes")) ?? {}) as {
    networkVolumes?: { id: string; name: string; size: number }[];
  };
  const volume = networkVolumes.find((v) => v.name === NOM_VOLUME);
  if (!volume || volume.size >= TAILLE_VOLUME_GO) return;
  await v2(`/v2/network-volumes/${encodeURIComponent(volume.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ size: TAILLE_VOLUME_GO }),
  });
}

// Dépense réelle facturée par RunPod depuis le début du mois (serveur, démarrages, attente et disque compris)
export async function depenseRunPodMois(): Promise<{ total: number; serveur: number; disque: number } | null> {
  if (!process.env.RUNPOD_API_KEY) return null;
  const now = new Date();
  const debut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  try {
    const data = (await v2(`/v2/billing?bucketSize=day&startTime=${encodeURIComponent(debut)}`)) as {
      metadata?: { totals?: Record<string, number> };
    } | null;
    const t = data?.metadata?.totals;
    if (!t) return null;
    const n = (k: string) => Number(t[k] ?? 0);
    return {
      total: n("totalAmount"),
      serveur: n("serverlessGpuAmount") + n("serverlessCpuAmount") + n("serverlessDiskAmount") + n("serverlessFeeAmount"),
      disque: n("storageStandardAmount") + n("storageHighPerformanceAmount"),
    };
  } catch {
    return null;
  }
}

const IMAGE_VERSION = `ghcr.io/randnjara/studio-video-ia-worker:v${VERSION_SERVEUR}`;

// RunPod garde l'image en cache : on lui indique la version exacte quand le dossier worker/ a changé
export async function mettreAJourServeur(supabase: SupabaseClient, endpointId: string) {
  const cleImage = `${CLE_IMAGE}:${endpointId}`;
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", cleImage).maybeSingle();
  if (data?.valeur === IMAGE_VERSION) return;
  await v2(`/v2/serverless/${encodeURIComponent(endpointId)}`, {
    method: "PATCH",
    body: JSON.stringify({ image: IMAGE_VERSION }),
  });
  await supabase.from("reglages").upsert({ cle: cleImage, valeur: IMAGE_VERSION });
}

// Cache gratuit de RunPod : un serveur par modèle (champ « Model » du serveur, réglé dans la console RunPod).
// Le modèle reste sur les machines de RunPod sans frais de stockage, et son téléchargement n'est pas facturé.
export const SERVEURS_CACHE = {
  video: { nom: "studio-video-cache", modele: "Wan-AI/Wan2.2-I2V-A14B-Diffusers" },
  photo: { nom: "studio-photo-cache", modele: "Qwen/Qwen-Image-Edit-2511" },
} as const;
const MODELE_CACHE = "studio-serveur-cache";
// Serveurs créés mais pas encore utilisés (en attente du réglage « Model » dans la console RunPod)
export const CLE_CACHE_VIDEO = "runpod_cache_video";
export const CLE_CACHE_PHOTO = "runpod_cache_photo";

export async function creerServeursCache(): Promise<{ video: string; photo: string }> {
  const video = await creerServeur(SERVEURS_CACHE.video.nom, MODELE_CACHE, IMAGE_VERSION);
  const photo = await creerServeur(SERVEURS_CACHE.photo.nom, MODELE_CACHE, IMAGE_VERSION);
  return { video, photo };
}

// Supprime l'ancien serveur (attaché au disque) puis le disque payant
export async function supprimerAncienServeurEtDisque(ancienEndpoint: string | null) {
  if (ancienEndpoint) await rest(`/endpoints/${encodeURIComponent(ancienEndpoint)}`, { method: "DELETE" });
  const volumes = ((await rest("/networkvolumes")) ?? []) as { id: string; name: string }[];
  for (const v of volumes.filter((x) => x.name === NOM_VOLUME))
    await rest(`/networkvolumes/${encodeURIComponent(v.id)}`, { method: "DELETE" });
}

// Arrêt de nos serveurs : plus aucune machine ne peut s'allumer (0 machine au maximum, 0 gardée allumée),
// la file d'attente de RunPod est vidée et les calculs en cours sont annulés. Rien n'est plus facturé.
// Renvoie le nombre de machines autorisées avant l'arrêt, pour le remettre au redémarrage.
export async function arreterServeurs(ids: string[], jobsEnCours: { serveur: string; jobId: string }[]) {
  const max: Record<string, number> = {};
  for (const id of ids) {
    const avant = (await rest(`/endpoints/${encodeURIComponent(id)}`).catch(() => null)) as { workersMax?: number } | null;
    max[id] = avant?.workersMax && avant.workersMax > 0 ? avant.workersMax : 2;
    await rest(`/endpoints/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ workersMin: 0, workersMax: 0 }),
    });
  }
  const appel = (serveur: string, chemin: string) =>
    fetch(`https://api.runpod.ai/v2/${encodeURIComponent(serveur)}${chemin}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
    }).catch(() => undefined);
  await Promise.all([
    ...ids.map((id) => appel(id, "/purge-queue")),
    ...jobsEnCours.map((j) => appel(j.serveur, `/cancel/${encodeURIComponent(j.jobId)}`)),
  ]);
  return max;
}

export async function redemarrerServeurs(max: Record<string, number>) {
  for (const [id, workersMax] of Object.entries(max))
    await rest(`/endpoints/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ workersMax: workersMax > 0 ? workersMax : 2 }),
    });
}
