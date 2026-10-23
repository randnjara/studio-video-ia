export const STATUTS_PROJET: Record<string, string> = {
  scenario: "Nouveau",
  production: "Production des plans",
  montage: "Montage",
  a_valider: "À valider",
  valide: "Validé",
  livre: "Livré",
  archive: "Archivé",
};

export const FORMATS = ["9:16", "16:9", "1:1"] as const;

export function dateCourte(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export const LIBELLES_FORMAT: Record<string, string> = {
  "9:16": "9:16 vertical (Facebook, TikTok)",
  "16:9": "16:9 horizontal (YouTube)",
  "1:1": "1:1 carré",
};

export const STATUTS_PLAN: Record<string, string> = {
  brouillon: "Brouillon",
  en_generation: "En génération",
  a_valider: "À valider",
  validee: "Validé",
  refusee: "Refusé",
};

// Couleur de la pastille selon l'avancement
export function couleurStatut(statut: string) {
  if (statut === "validee" || statut === "valide" || statut === "livre") return "bg-succes-doux text-succes";
  if (statut === "en_generation" || statut === "production" || statut === "montage") return "bg-accent-doux text-accent";
  if (statut === "a_valider") return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  if (statut === "refusee" || statut === "a_corriger") return "bg-alerte-doux text-alerte";
  return "bg-surface-2 text-sourdine";
}

// Durée lisible : 95 → « 1 min 35 s »
export function dureeLisible(secondes: number) {
  const m = Math.floor(secondes / 60);
  const s = Math.round(secondes % 60);
  return m > 0 ? `${m} min${s ? ` ${s} s` : ""}` : `${s} s`;
}

// Mouvement proposé quand le script n'en précise pas (le modèle comprend surtout l'anglais)
export const MOUVEMENT_PAR_DEFAUT = "subtle natural movement, gentle slow camera push-in, soft cinematic lighting";

export const STATUTS_MONTAGE: Record<string, string> = {
  brouillon: "Brouillon",
  a_valider: "À valider",
  valide: "Validé",
  a_corriger: "À corriger",
};

// Genres des « références du film » utilisées pour créer les photos de départ
export const GENRES: Record<string, string> = {
  personnage: "Personnage",
  lieu: "Lieu",
  produit: "Produit (promotion)",
  objet: "Objet",
  style: "Style",
};

// Fiche de tournage d'un plan : listes proposées (on peut aussi écrire autre chose)
export const CADRAGES = [
  "très gros plan",
  "gros plan",
  "plan rapproché",
  "plan poitrine",
  "plan taille",
  "plan américain",
  "plan moyen",
  "plan large",
  "plan d'ensemble",
];
export const ANGLES = ["face", "3/4 gauche", "3/4 droit", "profil gauche", "profil droit", "dos", "plongée", "contre-plongée"];

// Grille de contrôle obligatoire avant de valider un clip
// Points à améliorer la prochaine fois, cochés (ou non) en validant un clip : rien n'est obligatoire
export const CONTROLES_CLIP: Record<string, string> = {
  visage: "Visage, âge ou tenue différents des références",
  mains: "Mains ou doigts pas naturels, membre en trop",
  mouvement: "Mouvement figé ou déformation (morphing)",
  cadre: "Mauvais format, texte ou bord flou dans l'image",
  raccord: "Mauvais raccord avec le plan précédent ou suivant",
};
