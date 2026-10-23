// Studio voix : le catalogue des voix et les réglages de la table de mixage.
// Aucun appel réseau ici : ce fichier sert au navigateur comme au serveur.

export type MoteurVoix = "mms" | "kokoro" | "chatterbox" | "personne";

export type Voix = {
  id: string;
  nom: string;
  langue: string;
  genre: "femme" | "homme" | "autre";
  age: "enfant" | "adulte" | "age";
  moteur: MoteurVoix;
  modele: string;
  reference_path: string | null;
  reglages: Partial<Reglages>;
  description: string;
  usage_commercial: boolean;
  par_defaut: boolean;
  created_by: string | null;
};

export const CHAMPS_VOIX =
  "id, nom, langue, genre, age, moteur, modele, reference_path, reglages, description, usage_commercial, par_defaut, created_by";

export const LANGUES: Record<string, string> = {
  mg: "Malgache",
  fr: "Français",
  "fr-CA": "Français (Canada)",
  en: "Anglais",
  "en-US": "Anglais (États-Unis)",
  "en-GB": "Anglais (Royaume-Uni)",
  es: "Espagnol",
  zh: "Chinois",
  de: "Allemand",
  it: "Italien",
  pt: "Portugais",
  "pt-BR": "Portugais (Brésil)",
  ar: "Arabe",
  sw: "Swahili",
  ms: "Malais",
  hi: "Hindi",
  ja: "Japonais",
  ko: "Coréen",
  ru: "Russe",
  nl: "Néerlandais",
  tr: "Turc",
  pl: "Polonais",
  sv: "Suédois",
  da: "Danois",
  no: "Norvégien",
  fi: "Finnois",
  el: "Grec",
  he: "Hébreu",
};
export const nomLangue = (code: string) => LANGUES[code] ?? code;

// Langues que Chatterbox sait dire avec la voix d'une personne. Les autres (le malgache) passent par MMS,
// puis la voix est convertie avec le timbre de la personne.
const CHATTERBOX = new Set(["ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"]);
export const codeChatterbox = (langue: string) => {
  const code = langue.split("-")[0];
  return CHATTERBOX.has(code) ? code : null;
};
// Langues proposées pour la voix d'une personne
export const LANGUES_PERSONNE = ["mg", "fr", "fr-CA", "en-US", "en-GB", ...[...CHATTERBOX].filter((c) => c !== "fr" && c !== "en")];

export const GENRES = { femme: "Femme", homme: "Homme", autre: "Autre" } as const;
export const AGES = { enfant: "Enfant", adulte: "Adulte", age: "Âgé(e)" } as const;
export const MOTEURS_VOIX: Record<MoteurVoix, string> = {
  mms: "Meta MMS",
  kokoro: "Kokoro",
  chatterbox: "Chatterbox",
  personne: "Voix d'une personne",
};

// L'émotion (expressivité) se règle avec Chatterbox, donc aussi pour la voix d'une personne dans une langue qu'il parle
export const avecEmotion = (v: Pick<Voix, "moteur" | "langue">) =>
  v.moteur === "chatterbox" || (v.moteur === "personne" && codeChatterbox(v.langue) !== null);

// Ce que le serveur voix doit faire pour dire un texte avec cette voix
export function pourServeur(v: Pick<Voix, "moteur" | "langue" | "modele">): {
  moteur: "mms" | "kokoro" | "chatterbox";
  modele: string;
} {
  if (v.moteur !== "personne") return { moteur: v.moteur, modele: v.modele };
  const code = codeChatterbox(v.langue);
  return code ? { moteur: "chatterbox", modele: code } : { moteur: "mms", modele: v.modele || "mlg" };
}

// ---------------------------------------------------------------------------
// Table de mixage
// ---------------------------------------------------------------------------

export type Effet = "aucun" | "radio" | "telephone" | "megaphone" | "robot" | "grotte";

export type Reglages = {
  vitesse: number; // 0,5 à 2 (1 = normal), sans changer la hauteur
  hauteur: number; // demi-tons, -12 à +12, sans changer la vitesse
  grave: number; // dB, -12 à +12
  medium: number;
  aigu: number;
  chevrotement: number; // 0 à 1 : voix qui tremble (âge)
  echo: number; // 0 à 1
  reverb: number; // 0 à 1
  effet: Effet;
  compresseur: boolean;
  volume: number; // 0 à 2
};

export const REGLAGES_DEFAUT: Reglages = {
  vitesse: 1,
  hauteur: 0,
  grave: 0,
  medium: 0,
  aigu: 0,
  chevrotement: 0,
  echo: 0,
  reverb: 0,
  effet: "aucun",
  compresseur: true,
  volume: 1,
};

export const EFFETS: { valeur: Effet; nom: string }[] = [
  { valeur: "aucun", nom: "Aucun" },
  { valeur: "radio", nom: "Radio" },
  { valeur: "telephone", nom: "Téléphone" },
  { valeur: "megaphone", nom: "Mégaphone" },
  { valeur: "robot", nom: "Robot" },
  { valeur: "grotte", nom: "Grotte" },
];

const borne = (v: unknown, min: number, max: number, defaut: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : defaut;
};

// Relit des réglages venus de la base ou du navigateur, en gardant des valeurs sûres
export function lireReglages(brut: unknown): Reglages {
  const r = (brut && typeof brut === "object" ? brut : {}) as Record<string, unknown>;
  const d = REGLAGES_DEFAUT;
  return {
    vitesse: borne(r.vitesse, 0.5, 2, d.vitesse),
    hauteur: borne(r.hauteur, -12, 12, d.hauteur),
    grave: borne(r.grave, -12, 12, d.grave),
    medium: borne(r.medium, -12, 12, d.medium),
    aigu: borne(r.aigu, -12, 12, d.aigu),
    chevrotement: borne(r.chevrotement, 0, 1, d.chevrotement),
    echo: borne(r.echo, 0, 1, d.echo),
    reverb: borne(r.reverb, 0, 1, d.reverb),
    effet: EFFETS.some((e) => e.valeur === r.effet) ? (r.effet as Effet) : d.effet,
    compresseur: typeof r.compresseur === "boolean" ? r.compresseur : d.compresseur,
    volume: borne(r.volume, 0, 2, d.volume),
  };
}

// Préréglages proposés sur la table, en plus de celui de la voix choisie
export const PRESETS: { nom: string; reglages: Partial<Reglages> }[] = [
  { nom: "Grand-mère", reglages: { hauteur: 2, vitesse: 0.85, chevrotement: 0.45, aigu: -3, reverb: 0.1 } },
  { nom: "Grand-père", reglages: { hauteur: -3, vitesse: 0.85, chevrotement: 0.35, aigu: -3 } },
  { nom: "Enfant", reglages: { hauteur: 6, vitesse: 1.08, aigu: 2 } },
  { nom: "Voix grave", reglages: { hauteur: -4, grave: 3 } },
  { nom: "Conteur", reglages: { vitesse: 0.9, grave: 3, reverb: 0.15 } },
  { nom: "Narrateur radio", reglages: { grave: 4, aigu: 2, effet: "radio" } },
  { nom: "Au téléphone", reglages: { effet: "telephone" } },
  { nom: "Écho de montagne", reglages: { echo: 0.6, reverb: 0.2 } },
  { nom: "Dans une église", reglages: { reverb: 0.7, vitesse: 0.95 } },
  { nom: "Robot", reglages: { effet: "robot", hauteur: -2 } },
];

// Ce qui diffère des réglages neutres (pour l'enregistrer dans une nouvelle voix)
export function differences(r: Reglages): Partial<Reglages> {
  return Object.fromEntries(
    Object.entries(r).filter(([k, v]) => REGLAGES_DEFAUT[k as keyof Reglages] !== v),
  ) as Partial<Reglages>;
}
