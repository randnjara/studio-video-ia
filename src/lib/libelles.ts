export const STATUTS_PROJET: Record<string, string> = {
  scenario: "Scénario",
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
