// Catégorie du film : elle règle la façon de découper (consigne ChatGPT) et les alertes du tableau des plans.
// Leçon du film de la grand-mère : une interview découpée comme un clip change de plan toutes les 5 s.
// Aucun appel réseau ici : ce fichier sert au navigateur comme au serveur.

export type Categorie = "interview" | "documentaire" | "film" | "promotion" | "tutoriel" | "clip";

type Regles = {
  libelle: string;
  // Une phrase pour le choix dans l'onglet Infos
  aide: string;
  // Durée habituelle d'un plan continu (un même cadrage, une même photo), en secondes
  planMin: number;
  planMax: number;
  // Règles de découpage données à l'assistant, propres à la catégorie
  consigne: string;
};

export const CATEGORIES: Record<Categorie, Regles> = {
  interview: {
    libelle: "Interview / témoignage",
    aide: "Une personne parle face caméra. Un même plan dure longtemps, seuls les gestes et l'expression changent.",
    planMin: 10,
    planMax: 40,
    consigne: `CATÉGORIE : INTERVIEW / TÉMOIGNAGE. Une personne parle à la caméra, comme dans un vrai reportage filmé.
- Un PLAN CONTINU dure de 10 à 40 s : plusieurs lignes de 5 s qui se suivent avec le même cadrage, le même angle, le même lieu et la même photo de départ. Le spectateur ne voit aucune coupe entre ces lignes.
- On change de plan continu seulement quand le sujet change vraiment (nouvelle partie du récit), ou pour un seul plan plus serré au moment le plus fort de l'émotion. Jamais au milieu d'une phrase. Pour un film d'une minute : 2 ou 3 plans continus au plus.
- Cadrages : plan taille ou plan poitrine, face ou 3/4. La personne reste assise ou debout à la même place pendant tout le plan continu.
- Gestes : petits et naturels (hochement de tête, main qui se lève un peu puis revient, sourire, regard qui part puis revient vers la caméra). Pas de grand geste de bras, pas de salut de la main.`,
  },
  documentaire: {
    libelle: "Documentaire",
    aide: "Une voix off raconte, l'image montre les lieux, les gens et les détails dont elle parle.",
    planMin: 5,
    planMax: 15,
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
    consigne: `CATÉGORIE : PROMOTION / PUBLICITÉ. Le rythme est rapide, le produit est la vedette.
- Plans courts (2 à 6 s), chaque plan montre ou utilise le produit, au moins un gros plan du produit seul et le produit dans le plan de fin.
- Si une personne témoigne face caméra sur le produit, ses lignes qui se suivent forment un plan continu (même cadrage, même photo), coupé par les plans du produit.`,
  },
  tutoriel: {
    libelle: "Tutoriel / démonstration",
    aide: "On montre comment faire, étape par étape. Un plan par étape, gros plans sur les mains.",
    planMin: 5,
    planMax: 30,
    consigne: `CATÉGORIE : TUTORIEL / DÉMONSTRATION. On montre comment faire, étape par étape.
- Un plan continu par étape (5 à 30 s) : même cadrage tant que l'étape dure. On coupe à l'étape suivante.
- Gros plans sur les mains et l'objet pour les gestes précis ; un plan taille de la personne pour présenter et conclure.`,
  },
  clip: {
    libelle: "Clip musical",
    aide: "Images qui suivent la musique. Plans courts, beaucoup de variété.",
    planMin: 1,
    planMax: 5,
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
