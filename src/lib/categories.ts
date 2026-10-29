// Catégorie du film : elle règle la façon de découper (consigne ChatGPT) et les alertes du tableau des plans.
// Leçon du film de la grand-mère : une interview découpée comme un clip change de plan toutes les 5 s.
// Aucun appel réseau ici : ce fichier sert au navigateur comme au serveur.

import { CADRAGES } from "@/lib/libelles";

export type Categorie = "interview" | "documentaire" | "film" | "promotion" | "tutoriel" | "clip";

type Regles = {
  libelle: string;
  // Une phrase pour le choix dans l'onglet Infos
  aide: string;
  // Durée habituelle d'un plan continu (un même cadrage, une même photo), en secondes
  planMin: number;
  planMax: number;
  // Prise unique : chaque ligne part de la dernière image de la ligne précédente, sur tout le film, même d'un plan continu
  // à l'autre. Le cadrage change par un mouvement de caméra pendant la première ligne du nouveau plan, jamais par une coupe.
  priseUnique: boolean;
  // Règles de découpage données à l'assistant, propres à la catégorie
  consigne: string;
};

export const CATEGORIES: Record<Categorie, Regles> = {
  interview: {
    libelle: "Interview / témoignage",
    aide: "Une personne parle face caméra, en une seule prise : chaque clip part de la dernière image du précédent, le cadrage change par un lent zoom, jamais par une coupe.",
    planMin: 10,
    planMax: 40,
    priseUnique: true,
    consigne: `CATÉGORIE : INTERVIEW / TÉMOIGNAGE. Une personne parle à la caméra, comme dans un vrai reportage filmé.
- PRISE UNIQUE : tout le film est UNE SEULE PRISE, sans aucune coupe. Le studio crée une seule photo (celle de la ligne 1) ; chaque ligne suivante part de la DERNIÈRE IMAGE de la vidéo précédente, même quand le plan continu change.
- Un PLAN CONTINU = un cadrage tenu de 10 à 40 s, caméra fixe. On change de plan continu seulement quand le sujet change vraiment, ou pour se rapprocher au moment le plus fort de l'émotion. Jamais au milieu d'une phrase. Pour un film d'une minute : 2 ou 3 plans continus au plus.
- CHANGER DE CADRAGE = UN MOUVEMENT DE CAMÉRA, PAS UNE COUPE. La première ligne d'un nouveau plan continu commence au cadrage du plan précédent ; son prompt_video commence par un mouvement lent qui arrive au nouveau cadrage en 2 à 3 s ("0-3s: the camera slowly pushes in to a chest-up shot while she speaks…"), puis la caméra reste fixe. Surtout des rapprochements (slow push-in) ; un recul (slow pull-back) au plus une fois, car l'IA doit alors inventer le décor autour. Pas de changement d'angle : la personne reste face ou 3/4, du même côté.
- Commence assez large (plan taille ou plan américain) pour pouvoir te rapprocher ensuite (plan poitrine, plan rapproché, gros plan).
- La personne reste assise ou debout à la même place pendant tout le film.
- Gestes : petits et naturels (hochement de tête, main qui se lève un peu puis revient, sourire, regard qui part puis revient vers la caméra). Pas de grand geste de bras, pas de salut de la main.`,
  },
  documentaire: {
    libelle: "Documentaire",
    aide: "Une voix off raconte, l'image montre les lieux, les gens et les détails dont elle parle.",
    planMin: 5,
    planMax: 15,
    priseUnique: false,
    consigne: `CATÉGORIE : DOCUMENTAIRE. Une voix off raconte ; l'image montre ce dont elle parle.
- Un plan continu dure de 5 à 15 s (une ou plusieurs lignes de 5 s). On coupe à chaque nouvelle information, jamais au milieu d'une phrase.
- Alterne plans larges (le lieu), plans moyens (les gens qui agissent) et plans de détail (mains, objets) ; la personne ne parle pas à la caméra sauf si la voix off est la sienne.
- Mouvements de caméra lents et réguliers (lente avancée, léger panoramique) bienvenus.`,
  },
  film: {
    libelle: "Film / drama",
    aide: "Des personnages, une histoire, des dialogues. On coupe souvent, mais le décor, la lumière et les tenues ne changent pas dans une scène.",
    planMin: 2,
    planMax: 10,
    priseUnique: false,
    consigne: `CATÉGORIE : FILM / DRAMA. Une histoire avec des personnages, comme les séries courtes.
- On coupe souvent (plans de 2 à 10 s), mais chaque coupe a une raison : celui qui parle, puis celui qui écoute (réaction), puis un détail (main, objet, regard). Environ un plan de détail tous les 4 ou 5 plans.
- Dans une scène, le lieu, l'heure, la lumière, les tenues et le côté où chacun regarde ne changent jamais (règle des 180°).
- Ouvre chaque scène par un plan large, puis resserre sur l'émotion. Quand deux personnages se parlent, des plans par-dessus l'épaule (l'épaule de l'autre au premier plan, floue).`,
  },
  promotion: {
    libelle: "Promotion / publicité",
    aide: "Un produit est la vedette. Rythme rapide, le produit bien visible.",
    planMin: 2,
    planMax: 6,
    priseUnique: false,
    consigne: `CATÉGORIE : PROMOTION / PUBLICITÉ. Le rythme est rapide, le produit est la vedette.
- Plans courts (2 à 6 s), chaque plan montre ou utilise le produit, au moins un gros plan du produit seul et le produit dans le plan de fin.
- Si une personne témoigne face caméra sur le produit, ses lignes qui se suivent forment un plan continu (même cadrage, même photo), coupé par les plans du produit.`,
  },
  tutoriel: {
    libelle: "Tutoriel / démonstration",
    aide: "On montre comment faire, étape par étape. Un plan par étape, gros plans sur les mains.",
    planMin: 5,
    planMax: 30,
    priseUnique: false,
    consigne: `CATÉGORIE : TUTORIEL / DÉMONSTRATION. On montre comment faire, étape par étape.
- Un plan continu par étape (5 à 30 s) : même cadrage tant que l'étape dure. On coupe à l'étape suivante.
- Gros plans sur les mains et l'objet pour les gestes précis ; un plan taille de la personne pour présenter et conclure.`,
  },
  clip: {
    libelle: "Clip musical",
    aide: "Images qui suivent la musique. Plans courts, beaucoup de variété.",
    planMin: 1,
    planMax: 5,
    priseUnique: false,
    consigne: `CATÉGORIE : CLIP MUSICAL. Les images suivent le rythme de la musique.
- Plans courts (1 à 5 s), chaque ligne est en général son propre plan continu. Variété de cadrages, d'angles et de mouvements de caméra.
- Le lieu et la tenue restent les mêmes dans une même séquence.`,
  },
};

export const CATEGORIE_PAR_DEFAUT: Categorie = "film";

export function estCategorie(v: unknown): v is Categorie {
  return typeof v === "string" && v in CATEGORIES;
}

export const lireCategorie = (v: unknown): Categorie => (estCategorie(v) ? v : CATEGORIE_PAR_DEFAUT);

// Lignes du tableau qui continuent le plan continu de la ligne précédente : même numéro de plan continu.
// Elles reprennent la photo de départ de la première ligne du plan, sans en créer une nouvelle.
export function estSuite<T extends { plan_continu?: number | null }>(plans: T[], i: number) {
  const n = plans[i]?.plan_continu;
  return n != null && i > 0 && plans[i - 1]?.plan_continu === n;
}

// Ligne qui part de la dernière image de la ligne précédente : toujours en prise unique, sinon dans un même plan continu
export function enchainee<T extends { plan_continu?: number | null }>(plans: T[], i: number, categorie: Categorie) {
  return i > 0 && (CATEGORIES[categorie].priseUnique || estSuite(plans, i));
}

// Pour chaque ligne : son numéro de plan continu à l'écran (1, 2, 3…), sa place dans ce plan et le nombre de lignes du plan
export function plansContinus<T extends { plan_continu?: number | null }>(plans: T[]) {
  const infos: { numero: number; morceau: number; morceaux: number; tete: number }[] = [];
  let numero = 0;
  plans.forEach((_, i) => {
    if (estSuite(plans, i)) {
      const prec = infos[i - 1];
      infos.push({ numero: prec.numero, morceau: prec.morceau + 1, morceaux: 0, tete: prec.tete });
    } else infos.push({ numero: ++numero, morceau: 1, morceaux: 0, tete: i });
  });
  for (const info of infos) info.morceaux = infos.filter((x) => x.numero === info.numero).length;
  return infos;
}

// Nom anglais de chaque cadrage, pour le mouvement de caméra d'un changement de cadrage en prise unique
const CADRAGES_EN: Record<string, string> = {
  "très gros plan": "an extreme close-up of the face",
  "gros plan": "a close-up of the face",
  "plan rapproché": "a close shot of the head and shoulders",
  "plan poitrine": "a chest-up shot",
  "plan taille": "a waist-up shot",
  "plan américain": "a knee-up shot",
  "plan moyen": "a full-body shot",
  "plan large": "a wide shot",
  "plan d'ensemble": "a very wide establishing shot",
};

// Prise unique : la première ligne d'un nouveau cadrage part de l'image du cadrage précédent. Si sa consigne ne le fait
// pas déjà, le studio y ajoute un lent mouvement de caméra jusqu'au nouveau cadrage (et retire « caméra fixe »).
export function avecMouvement(consigne: string, avant?: string | null, apres?: string | null) {
  const i = CADRAGES.indexOf(avant ?? "");
  const j = CADRAGES.indexOf(apres ?? "");
  if (i < 0 || j < 0 || i === j || /push|pull|dolly|zoom|track/i.test(consigne)) return consigne;
  const sens = j < i ? "slowly pushes in" : "slowly pulls back";
  const sansFixe = consigne.replace(/^\s*(static|locked|fixed|tripod|camera (stays|holds|remains))[^.]*\.\s*/i, "");
  return `Camera: during the first 3 seconds the camera ${sens} from ${CADRAGES_EN[avant!]} to ${CADRAGES_EN[apres!]}, smoothly and continuously, then it stays still. ${sansFixe}`;
}
