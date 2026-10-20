import "server-only";

// Modèle Wan 2.2 image → vidéo, hébergé par RunPod (« Public Endpoint ») :
// rien à installer, on paie seulement les vidéos réussies.
const BASE = "https://api.runpod.ai/v2/wan-2-2-i2v-720";

// Prix affiché par RunPod pour une vidéo de 5 s en 720p, utilisé tant que la facture réelle n'est pas connue
export const PRIX_ESTIME_5S_USD = 0.3;

export const TAILLES: Record<string, string> = {
  "16:9": "1280*720",
  "9:16": "720*1280",
  "1:1": "960*960",
};

// Le modèle comprend surtout l'anglais
export const PROMPT_NEGATIF =
  "blurry, distorted, text, watermark, deformed face, deformed hands, extra fingers, static frame, oversaturated, low quality";

function cle() {
  const k = process.env.RUNPOD_API_KEY;
  if (!k) throw new Error("La clé RunPod n'est pas encore configurée (RUNPOD_API_KEY dans Cloudflare).");
  return k;
}

async function appel(chemin: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${chemin}`, {
    ...init,
    headers: { Authorization: `Bearer ${cle()}`, "Content-Type": "application/json" },
  });
  const texte = await res.text();
  if (!res.ok) throw new Error(`RunPod a répondu ${res.status} : ${texte.slice(0, 200)}`);
  return JSON.parse(texte);
}

export async function lancerGeneration(p: {
  prompt: string;
  imageUrl: string;
  format: string;
  duree: number;
  seed: number;
}): Promise<string> {
  const data = await appel("/run", {
    method: "POST",
    body: JSON.stringify({
      input: {
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
      },
    }),
  });
  return String(data.id);
}

export type StatutRunPod =
  | { etat: "en_cours" }
  | { etat: "terminee"; videoUrl: string; coutUsd: number | null; secondes: number | null }
  | { etat: "echouee"; erreur: string };

export async function lireStatut(jobId: string): Promise<StatutRunPod> {
  const data = await appel(`/status/${encodeURIComponent(jobId)}`);
  switch (data.status) {
    case "COMPLETED": {
      const url = data.output?.video_url ?? data.output?.result ?? data.output?.url;
      if (!url) return { etat: "echouee", erreur: "RunPod n'a pas renvoyé de vidéo." };
      const cout = Number(data.output?.cost);
      return {
        etat: "terminee",
        videoUrl: String(url),
        coutUsd: Number.isFinite(cout) ? cout : null,
        secondes: typeof data.executionTime === "number" ? data.executionTime / 1000 : null,
      };
    }
    case "FAILED":
    case "CANCELLED":
    case "TIMED_OUT":
      return { etat: "echouee", erreur: String(data.error ?? data.status).slice(0, 500) };
    default:
      return { etat: "en_cours" };
  }
}

export async function annulerJob(jobId: string) {
  await appel(`/cancel/${encodeURIComponent(jobId)}`, { method: "POST" }).catch(() => undefined);
}
