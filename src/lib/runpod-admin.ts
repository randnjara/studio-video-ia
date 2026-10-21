import "server-only";
import { cle } from "@/lib/runpod";

// Création de notre serveur de génération chez RunPod, avec la clé déjà enregistrée dans Cloudflare.
// L'image est construite par GitHub à chaque changement du dossier worker/ (.github/workflows/serveur-video.yml).
export const IMAGE_SERVEUR = "ghcr.io/randnjara/studio-video-ia-worker:latest";
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
