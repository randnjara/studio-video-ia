// Prompt de vérification du script et des plans, à coller dans un assistant gratuit (ChatGPT, Claude, Gemini…).
// Rien n'est envoyé par le studio : la personne copie le texte et le colle elle-même.
import { CATEGORIES, type Categorie, plansContinus } from "@/lib/categories";

type PlanVerif = {
  position: number;
  motion_prompt: string;
  voiceover_text: string;
  duration_s: number;
  image_description?: string;
  cadrage?: string;
  angle?: string;
  lieu?: string;
  intention?: string;
  pose_debut?: string;
  pose_fin?: string;
  image_path?: string | null;
  plan_continu?: number | null;
};

// Colonnes du fichier corrigé rendu par l'assistant, réimporté dans l'onglet Plans (mise à jour des plans existants)
// « plan_continu » est donné pour information : le regroupement des lignes ne se corrige pas par ce fichier.
export const COLONNES_CORRECTION = [
  "numero",
  "plan_continu",
  "verdict",
  "probleme",
  "photo_a_refaire",
  "voix",
  "duree",
  "intention",
  "cadrage",
  "angle",
  "lieu",
  "pose_debut",
  "pose_fin",
  "prompt_image",
  "prompt_video",
] as const;
export const FICHIER_CORRIGE = "tableau_corrige.csv";

const cellule = (v: string) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;

export function promptVerification(
  projet: { title: string; aspect_ratio: string; scenario_text: string },
  plans: PlanVerif[],
  produits: string[] = [],
  categorie: Categorie = "film",
) {
  const cat = CATEGORIES[categorie];
  const continus = plansContinus(plans);
  const tableau = [
    COLONNES_CORRECTION.join(";"),
    ...plans.map((p, i) =>
      [
        String(i + 1),
        String(continus[i].numero),
        "",
        "",
        "",
        p.voiceover_text,
        String(Number(p.duration_s || 5)),
        p.intention ?? "",
        p.cadrage ?? "",
        p.angle ?? "",
        p.lieu ?? "",
        p.pose_debut ?? "",
        p.pose_fin ?? "",
        p.image_description ?? "",
        p.motion_prompt,
      ]
        .map(cellule)
        .join(";"),
    ),
  ].join("\n");

  // Les photos de départ sont créées APRÈS la vérification : une photo absente est normale, jamais une erreur
  const avecPhoto = plans.flatMap((p, i) => (p.image_path ? [i + 1] : []));
  const photos =
    avecPhoto.length === 0
      ? "Aucune photo de départ n'est encore créée : c'est NORMAL, elles seront créées APRÈS cette vérification, à partir de « prompt_image » et des photos de référence."
      : `Photos de départ déjà créées pour les plans ${avecPhoto.join(", ")}. Les autres plans n'ont pas encore de photo : c'est NORMAL, elles seront créées APRÈS cette vérification.`;

  return `Tu es scripte (responsable de la continuité) et réalisateur sur un film tourné entièrement en vidéo générée par IA.
Chaque plan est un clip de 5 s au plus, créé par le modèle Wan 2.2 « image vers vidéo » : il part d'une PHOTO DE DÉPART (créée à partir de « prompt_image » et des photos de référence) et l'anime selon « prompt_video ». Le modèle ne connaît ni les autres plans ni le script : toute la continuité dépend des photos de départ et des consignes.

FILM : « ${projet.title} » — format ${projet.aspect_ratio} — ${plans.length} lignes — catégorie : ${cat.libelle}

=== RÈGLES ABSOLUES, VALABLES POUR TOUT LE FILM (à vérifier avant tout le reste) ===
1. COMPRENDRE AVANT D'AGIR : chaque geste, mouvement de caméra, changement de cadrage, de lieu ou de personnage vient de ce que dit le texte à ce moment précis. Ce que le texte ne demande pas, supprime-le.
2. PRISE UNIQUE : une ligne = un clip de 5 s au plus ; la ligne 1 part de l'unique photo du film, chaque ligne suivante part de la DERNIÈRE IMAGE de la vidéo précédente, du début à la fin du film, même avant un changement de lieu ou de personnage : aucune coupe. Les lignes qui se suivent avec le même « plan_continu » gardent le même cadrage, caméra fixe. Le prompt_image est le même sur tout le film, chaque pose_debut reprend la pose_fin précédente : c'est voulu, ne le « varie » pas. Ne change jamais la colonne plan_continu.
3. CATÉGORIE « ${cat.libelle} » : ses règles ci-dessous fixent le rythme.
4. CHANGEMENTS RARES ET AU MILIEU : un zoom, un changement de cadrage (première ligne d'un nouveau plan continu), de lieu ou de personnage n'arrive que s'il est vraiment nécessaire, et toujours AU MILIEU de la ligne (pour 5 s : entre 1 s et 4 s), jamais pendant la première ni la dernière seconde. Un lieu ou un personnage nouveau n'apparaît jamais d'un coup : la personne s'y rend, la caméra y va, ou le personnage entre dans le cadre.
${cat.consigne}

=== PHOTOS DE DÉPART ===
${photos}
Une photo absente n'est JAMAIS un problème : ne la signale pas, ne mets pas CORRIGÉ pour cela, n'en parle pas dans ta réponse. Juge la continuité à partir des prompts, des poses et des photos de référence.

=== SCRIPT COMPLET ===
${projet.scenario_text.trim() || "(aucun script enregistré)"}

=== TABLEAU ACTUEL DES PLANS (CSV, séparateur point-virgule, dans l'ordre du montage) ===
${tableau}

=== CE QUE TU DOIS VÉRIFIER ===
1. Respect du script : chaque moment important a son plan, dans le bon ordre, sans plan en double.
2. Lieux : le moins de lieux possible (un seul pour un film de 2 minutes ou moins : c'est le geste qui fait varier), de longues séquences par lieu ; jamais de changement de lieu au milieu d'une phrase ou d'une idée, ni de lieu tenu un seul plan. Un témoignage reste dans un seul lieu (un souvenir se raconte depuis ce lieu). Corrige « lieu », les poses et les prompts en conséquence.
2 bis. Découpage : les règles absolues et celles de la catégorie passent avant tout. Deux plans continus qui se suivent changent le cadrage, par un lent mouvement de caméra au milieu de la première ligne du nouveau plan ; dans un même plan continu, rien ne change. Caméra toujours du même côté de la personne dans une séquence (règle des 180°).
2 ter. Continuité entre plans voisins : visage, âge, coiffure, tenue, accessoires, objets, lieu, moment de la journée, lumière, direction du regard (règle des 180°) ; sur tout le film, chaque ligne reprend exactement la pose_fin de la précédente, commence et finit sur une image calme (caméra fixe pendant la première et la dernière seconde). Dans un même lieu, aucun prompt_image n'invente ou ne change un élément du décor (banc, fleurs, colonnes, couleur du ciel, heure) : corrige-le pour qu'il ne garde que le nom du lieu et ce qui est derrière la personne dans ce cadrage.
3. Chaque prompt_video : une seule action principale réalisable dans la durée, découpée en temps (0-1s, 1-3s…), caméra précise (fixe, ou un seul mouvement lent au milieu de la ligne), rien qui contredise la photo de départ, pas de texte à l'écran, mains visibles si un geste les montre (sinon adapter le cadrage ou remplacer le geste par une expression), lèvres libres pendant la parole.
4. Variété : aucun geste répété en boucle (comparer aux 10 lignes voisines), aucun cadrage ou angle répété d'un plan continu à l'autre ; chaque geste vient du sens de la réplique ; pas la même phrase recopiée au début ou à la fin de chaque prompt.
5. Langue : prompt_image et prompt_video en anglais ; les répliques (« voix ») restent EXACTEMENT telles quelles.
${
    produits.length
      ? `5 bis. Film de promotion (produit : ${produits.join(", ")}) : le produit est bien visible dès qu'on en parle, avec un gros plan du produit seul et le plan de fin ; son nom exact est écrit dans « prompt_image » de chaque plan où il apparaît ; les gestes le montrent sans le cacher.
`
      : ""
  }6. Seulement si je te joins des photos de départ déjà créées : compare-les entre elles et avec les prompts. Sinon, ne parle pas des photos.

=== RÉPONSE ATTENDUE ===
1. D'abord le FICHIER CORRIGÉ, à télécharger, nommé ${FICHIER_CORRIGE}, en CSV UTF-8, séparateur point-virgule, chaque cellule entre guillemets, avec exactement ces colonnes dans cet ordre :
${COLONNES_CORRECTION.join(";")}
   - Une ligne par plan, TOUS les ${plans.length} plans, dans l'ordre, avec le même « numero » (1 à ${plans.length}). N'ajoute, ne supprime et ne renumérote aucun plan.
   - « verdict » : OK ou CORRIGÉ. « probleme » : le problème en une phrase en français (vide si OK).
   - « photo_a_refaire » : oui seulement pour un plan dont la photo de départ existe déjà et doit être recréée (pose, cadrage, angle, lieu ou tenue changés) ; toujours non pour un plan sans photo.
   - Plan OK : recopie ses valeurs actuelles à l'identique. Plan corrigé : remplis toutes les colonnes avec la version corrigée.
   - « voix » : jamais modifiée. « duree » : 5 au plus.
   - « prompt_image » en anglais, 30 à 70 mots : l'instant figé au début du plan (qui, où, pose_debut, expression, cadrage, angle, lumière), sans mouvement.
   - « prompt_video » en anglais, 40 à 80 mots, découpé en temps jusqu'à la durée, qui finit exactement sur la pose_fin.
   - « plan_continu » : recopie la valeur actuelle, sans la changer.
   - Si tu ne peux pas créer de fichier, donne exactement le même contenu dans un seul bloc \`\`\`csv.
2. Ensuite, en français simple et en quelques lignes seulement :
   A. Les problèmes de continuité les plus graves (plans concernés et correction faite dans le fichier).
   B. Les plans qu'il faudrait ajouter (après quel plan, voix, prompt_video) : je les ajouterai moi-même.
   C. Une fiche de continuité courte : personnages et tenues, lieux et lumière, palette, style de caméra.
Pas de long tableau dans la discussion : tout ce qui concerne les plans va dans le fichier.`;
}
