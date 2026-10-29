// Catégorie du film : elle règle le rythme (consigne ChatGPT) et les alertes du tableau des plans.
// Leçon du film de la grand-mère : une interview découpée comme un clip change de plan toutes les 5 s.
// Règle commune à toutes les catégories (demande de NJARA) : tout le film est UNE SEULE PRISE. Chaque clip part de la
// dernière image du clip précédent ; un zoom, un changement de cadrage ou de lieu est rare et se fait au milieu d'un
// clip, jamais à sa première ou à sa dernière seconde. La catégorie règle seulement le rythme de ces changements.
// Aucun appel réseau ici : ce fichier sert au navigateur comme au serveur.

import { CADRAGES } from "@/lib/libelles";

export type Categorie = "interview" | "documentaire" | "film" | "promotion" | "tutoriel" | "clip";

type Regles = {
  libelle: string;
  // Une phrase pour le choix dans l'onglet Infos
  aide: string;
  // Durée habituelle d'un plan continu (un même cadrage tenu, caméra fixe), en secondes
  planMin: number;
  planMax: number;
  // Règles propres à la catégorie, données à l'assistant
  consigne: string;
};

export const CATEGORIES: Record<Categorie, Regles> = {
  interview: {
    libelle: "Interview / témoignage",
    aide: "Une personne parle face caméra. Le cadrage tient longtemps ; seuls les gestes et l'expression changent, avec de rares zooms lents.",
    planMin: 10,
    planMax: 40,
    consigne: `CATÉGORIE : INTERVIEW / TÉMOIGNAGE. Une personne parle à la caméra, comme dans un vrai reportage filmé.
- Un plan continu (un cadrage tenu, caméra fixe) dure de 10 à 40 s. On change de cadrage seulement quand le sujet change vraiment, ou pour se rapprocher au moment le plus fort de l'émotion. Pour un film d'une minute : 2 ou 3 plans continus au plus.
- Changements de cadrage : surtout de lents rapprochements (slow push-in) ; un recul (slow pull-back) au plus une fois, car l'IA doit alors inventer le décor autour. Pas de changement d'angle : la personne reste face ou 3/4, du même côté.
- Commence assez large (plan taille ou plan américain) pour pouvoir te rapprocher ensuite (plan poitrine, plan rapproché, gros plan).
- Un seul lieu ; la personne reste assise ou debout à la même place pendant tout le film.
- Gestes : petits et naturels (hochement de tête, main qui se lève un peu puis revient, sourire, regard qui part puis revient vers la caméra). Pas de grand geste de bras, pas de salut de la main.`,
  },
  documentaire: {
    libelle: "Documentaire",
    aide: "Une voix off raconte, la caméra montre les lieux, les gens et les détails dont elle parle, par des mouvements lents.",
    planMin: 5,
    planMax: 15,
    consigne: `CATÉGORIE : DOCUMENTAIRE. Une voix off raconte ; l'image montre ce dont elle parle.
- Un plan continu dure de 5 à 15 s. À chaque nouvelle information importante, la caméra va vers ce dont parle la voix (lent panoramique, lente avancée vers un détail, recul pour montrer le lieu), au milieu d'un clip.
- La personne ne parle pas à la caméra sauf si la voix off est la sienne.
- Un nouveau lieu seulement quand la voix off parle vraiment d'un autre endroit.`,
  },
  film: {
    libelle: "Film / drama",
    aide: "Des personnages, une histoire, des dialogues. La caméra suit l'action en continu ; le décor, la lumière et les tenues ne changent pas dans une scène.",
    planMin: 4,
    planMax: 15,
    consigne: `CATÉGORIE : FILM / DRAMA. Une histoire avec des personnages, comme les séries courtes.
- Pas de coupe : quand l'attention passe d'un personnage à l'autre (celui qui parle, puis celui qui écoute), la caméra y va par un lent panoramique ou un léger déplacement au milieu d'un clip, et seulement si la réplique le demande. Un personnage qui entre doit être déjà dans le lieu (visible ou juste hors champ) dès la photo de départ.
- Dans une scène, le lieu, l'heure, la lumière, les tenues et le côté où chacun regarde ne changent jamais (règle des 180°).
- Une scène commence en général assez large, puis la caméra se rapproche lentement de l'émotion.`,
  },
  promotion: {
    libelle: "Promotion / publicité",
    aide: "Un produit est la vedette, toujours bien visible. La caméra va vers lui par des mouvements nets mais fluides.",
    planMin: 4,
    planMax: 10,
    consigne: `CATÉGORIE : PROMOTION / PUBLICITÉ. Le produit est la vedette.
- Un plan continu dure de 4 à 10 s. La caméra se rapproche du produit quand on en parle (au moins un rapprochement jusqu'au produit en gros plan) et le garde dans le cadre jusqu'à la fin.
- Si une personne témoigne sur le produit, elle le tient ou il est posé près d'elle dès la photo de départ.`,
  },
  tutoriel: {
    libelle: "Tutoriel / démonstration",
    aide: "On montre comment faire, étape par étape. La caméra se rapproche des mains pour les gestes précis.",
    planMin: 5,
    planMax: 30,
    consigne: `CATÉGORIE : TUTORIEL / DÉMONSTRATION. On montre comment faire, étape par étape.
- Un plan continu par étape (5 à 30 s) : même cadrage tant que l'étape dure.
- Pour un geste précis, la caméra se rapproche lentement des mains et de l'objet, au milieu d'un clip ; elle recule ensuite vers un plan taille pour conclure.`,
  },
  clip: {
    libelle: "Clip musical",
    aide: "Images qui suivent la musique, avec plus de mouvements de caméra que les autres catégories, toujours sans coupe.",
    planMin: 3,
    planMax: 10,
    consigne: `CATÉGORIE : CLIP MUSICAL. Les images suivent le rythme de la musique.
- Un plan continu dure de 3 à 10 s : c'est la catégorie où la caméra bouge le plus (rapprochements, reculs, panoramiques, sur le temps fort de la musique), mais toujours au milieu d'un clip et jamais deux mouvements dans le même clip.
- Le lieu et la tenue restent les mêmes dans une même séquence.`,
  },
};

export const CATEGORIE_PAR_DEFAUT: Categorie = "film";

export function estCategorie(v: unknown): v is Categorie {
  return typeof v === "string" && v in CATEGORIES;
}

export const lireCategorie = (v: unknown): Categorie => (estCategorie(v) ? v : CATEGORIE_PAR_DEFAUT);

// Lignes du tableau qui continuent le plan continu de la ligne précédente : même numéro, donc même cadrage, caméra fixe
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

// Nom anglais de chaque cadrage, pour le mouvement de caméra d'un changement de cadrage
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

// Mouvements de la caméra seulement : « she tilts her head » ou « pulls her shawl » ne sont pas des mouvements de caméra
export const MOTS_MOUVEMENT =
  /\b(push(es|ed|ing)?[- ]in|pull(s|ed|ing)?[- ](back|out)|dolly|zoom(s|ed|ing)?|pan(s|ned|ning)?\b|camera (moves|glides|drifts|travels|orbits|tracks|cranes))/i;

// Fenêtre d'un changement (zoom, cadrage, lieu) dans un clip : jamais pendant la première ni la dernière seconde,
// pour que le raccord avec le clip d'avant et celui d'après se fasse sur une image calme
export const fenetreMouvement = (duree: number) => ({ debut: 1, fin: Math.max(2, (Number(duree) || 5) - 1) });

// La première ligne d'un nouveau cadrage part de l'image du cadrage précédent. Si sa consigne ne le fait pas déjà, le
// studio y ajoute un lent mouvement de caméra jusqu'au nouveau cadrage, au milieu du clip (et retire « caméra fixe »).
export function avecMouvement(consigne: string, avant?: string | null, apres?: string | null, duree = 5) {
  const i = CADRAGES.indexOf(avant ?? "");
  const j = CADRAGES.indexOf(apres ?? "");
  if (i < 0 || j < 0 || i === j || MOTS_MOUVEMENT.test(consigne)) return consigne;
  const sens = j < i ? "slowly pushes in" : "slowly pulls back";
  const { debut, fin } = fenetreMouvement(duree);
  const sansFixe = consigne.replace(/^\s*(static|locked|fixed|tripod|camera (stays|holds|remains))[^.]*\.\s*/i, "");
  return `Camera: still from 0s to ${debut}s; from ${debut}s to ${fin}s it ${sens} smoothly from ${CADRAGES_EN[avant!]} to ${CADRAGES_EN[apres!]}; still again for the last second. ${sansFixe}`;
}

// Moment du premier mouvement de caméra écrit dans une consigne découpée en temps (« 1-3s: … slow push-in … ») ;
// écrit avant la première tranche (« Slow push-in. 0-1s: … »), il dure tout le clip. null si aucun mouvement n'est écrit.
export function momentMouvement(consigne: string, duree = 5) {
  const tranches = [...consigne.matchAll(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*s\s*:/g)];
  if (MOTS_MOUVEMENT.test(consigne.slice(0, tranches[0]?.index ?? consigne.length))) return { debut: 0, fin: Number(duree) || 5 };
  for (let k = 0; k < tranches.length; k++) {
    const texte = consigne.slice(tranches[k].index! + tranches[k][0].length, tranches[k + 1]?.index ?? consigne.length);
    if (MOTS_MOUVEMENT.test(texte))
      return { debut: Number(tranches[k][1].replace(",", ".")), fin: Number(tranches[k][2].replace(",", ".")) };
  }
  return null;
}
