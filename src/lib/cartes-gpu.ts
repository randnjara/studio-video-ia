// Cartes graphiques autorisées à la création de chaque serveur RunPod, cohérentes avec son image (sans import : testable).
// Depuis vidéo v9, voix v6 et lip-sync v3, les images sont en CUDA 12.8 : elles gèrent les cartes Blackwell (sm_120 :
// RTX PRO 6000, B200…) comme celles d'avant (A100 sm_80, A40/3090 sm_86, L4/4090 sm_89, H100 sm_90). Une image plus
// ancienne (CUDA ≤ 12.6) plante sur Blackwell (« no kernel image is available »), d'où la liste explicite.

export type Sorte = "video" | "voix" | "lipsync";

// CUDA de chaque image, et si elle gère Blackwell
export const IMAGES_CUDA: Record<Sorte, { cuda: string; blackwell: boolean }> = {
  video: { cuda: "12.8", blackwell: true },
  voix: { cuda: "12.8", blackwell: true },
  lipsync: { cuda: "12.8", blackwell: true },
};

// Versions de CUDA des machines RunPod acceptées (pilote assez récent pour une image CUDA 12.8)
export const CUDA_AUTORISES = ["12.8", "12.9", "13.0"];

const BLACKWELL = /blackwell|\bB200\b|\bB100\b|RTX 50\d0|PRO 6000/i;
export const estBlackwell = (id: string) => BLACKWELL.test(id);

// Cartes de 80 à 96 Go (vidéo, photo, Visage fidèle, lip-sync) : le modèle 14B tient entier en mémoire
export const CARTES_GRANDES = [
  "NVIDIA A100 80GB PCIe",
  "NVIDIA A100-SXM4-80GB",
  "NVIDIA H100 80GB HBM3",
  "NVIDIA H100 PCIe",
  "NVIDIA H100 NVL",
  "NVIDIA RTX PRO 6000 Blackwell Server Edition",
];

// Petites cartes du serveur voix (16 à 24 Go) : noms acceptés par l'API de création de RunPod
export const CARTES_VOIX = [
  "NVIDIA RTX A4000",
  "NVIDIA RTX A4500",
  "NVIDIA RTX 4000 Ada Generation",
  "NVIDIA RTX A5000",
  "NVIDIA L4",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 4090",
];

// Liste envoyée à RunPod : les cartes prévues pour cette sorte de serveur, gardées seulement si RunPod les propose
// encore (« proposees » : la liste de son API, ou null si elle n'a pas répondu), sans Blackwell si l'image ne le gère pas
export function cartesAutorisees(sorte: Sorte, proposees: string[] | null): string[] {
  const prevues = (sorte === "voix" ? CARTES_VOIX : CARTES_GRANDES).filter((id) => IMAGES_CUDA[sorte].blackwell || !estBlackwell(id));
  if (!proposees?.length) return prevues;
  const gardees = prevues.filter((id) => proposees.includes(id));
  return gardees.length ? gardees : prevues;
}
