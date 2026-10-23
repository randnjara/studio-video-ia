import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cle } from "@/lib/runpod";

// Création de notre serveur de génération chez RunPod, avec la clé déjà enregistrée dans Cloudflare.
// L'image est construite par GitHub à chaque changement du dossier worker/ (.github/workflows/serveur-video.yml).
export const IMAGE_SERVEUR = "ghcr.io/randnjara/studio-video-ia-worker:latest";
// À augmenter avec worker/VERSION : le studio fait passer notre serveur sur cette image au prochain envoi
export const VERSION_SERVEUR = "2";
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

export async function creerServeur(): Promise<string> {
  // Réutilise le modèle de serveur s'il existe déjà (par exemple après un premier essai interrompu)
  const modeles = ((await rest("/templates").catch(() => [])) ?? []) as { id: string; name: string }[];
  let modele = modeles.find((m) => m.name === NOM);
  if (!modele) {
    modele = await rest("/templates", {
      method: "POST",
      body: JSON.stringify({
        name: NOM,
        imageName: IMAGE_SERVEUR,
        isServerless: true,
        containerDiskInGb: 150,
        env: {},
      }),
    });
  }
  if (!modele?.id) throw new Error("RunPod n'a pas renvoyé de modèle de serveur.");

  const existants = ((await rest("/endpoints").catch(() => [])) ?? []) as { id: string; name: string }[];
  const existant = existants.find((e) => e.name === NOM);
  if (existant) return existant.id;

  const endpoint = await rest("/endpoints", {
    method: "POST",
    body: JSON.stringify({
      name: NOM,
      templateId: modele.id,
      gpuTypeIds: await cartes80Go(),
      gpuCount: 1,
      workersMin: 0, // rien n'est payé quand rien ne tourne
      workersMax: 2,
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

// RunPod garde l'image en cache : on lui indique la version exacte quand le dossier worker/ a changé
export async function mettreAJourServeur(supabase: SupabaseClient, endpointId: string) {
  const image = `ghcr.io/randnjara/studio-video-ia-worker:v${VERSION_SERVEUR}`;
  const { data } = await supabase.from("reglages").select("valeur").eq("cle", CLE_IMAGE).maybeSingle();
  if (data?.valeur === image) return;
  await v2(`/v2/serverless/${encodeURIComponent(endpointId)}`, { method: "PATCH", body: JSON.stringify({ image }) });
  await supabase.from("reglages").upsert({ cle: CLE_IMAGE, valeur: image });
}
