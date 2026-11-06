// Cartes graphiques autorisées à la création des serveurs, cohérentes avec leur image (CUDA 12.8, Blackwell compris).
// Lancer : npm run test:lipsync
import { CARTES_VOIX, CUDA_AUTORISES, IMAGES_CUDA, cartesAutorisees, estBlackwell } from "../src/lib/cartes-gpu.ts";

const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};
vrai(estBlackwell("NVIDIA RTX PRO 6000 Blackwell Server Edition") && estBlackwell("NVIDIA B200") && !estBlackwell("NVIDIA H100 80GB HBM3"), "Blackwell reconnu");
vrai(Object.values(IMAGES_CUDA).every((i) => i.cuda === "12.8" && i.blackwell), "toutes les images en CUDA 12.8");
vrai(CUDA_AUTORISES[0] === "12.8", "machines avec un pilote CUDA 12.8 au moins");
// Grandes cartes : celles que RunPod propose encore, Blackwell compris avec les nouvelles images
const proposees = ["NVIDIA A100 80GB PCIe", "NVIDIA H100 80GB HBM3", "NVIDIA RTX PRO 6000 Blackwell Server Edition", "NVIDIA L4"];
const video = cartesAutorisees("video", proposees);
vrai(video.join() === "NVIDIA A100 80GB PCIe,NVIDIA H100 80GB HBM3,NVIDIA RTX PRO 6000 Blackwell Server Edition", video.join());
vrai(!video.includes("NVIDIA L4"), "jamais une petite carte pour la vidéo");
// RunPod ne répond pas : la liste prévue entière
vrai(cartesAutorisees("lipsync", null).length === 6, "liste prévue");
// Voix : petites cartes seulement
vrai(cartesAutorisees("voix", proposees).join() === "NVIDIA L4" && cartesAutorisees("voix", null).length === CARTES_VOIX.length, "voix");
// Une image sans Blackwell n'en reçoit jamais
IMAGES_CUDA.lipsync.blackwell = false;
vrai(!cartesAutorisees("lipsync", proposees).some(estBlackwell), "image ancienne : pas de Blackwell");
console.log("cartes autorisées : cohérentes avec les images CUDA 12.8 · OK");
