import { CATEGORIES, type Categorie } from "@/lib/categories";
import { ANGLES, CADRAGES } from "@/lib/libelles";

// Prompt de préparation : à coller dans un assistant (ChatGPT, Claude, Gemini…) avec la photo principale.
// Il découpe la voix off en plans et remplit le fichier vide du studio (format standard, CSV), qui se réimporte tel quel.
// Les règles reprennent les erreurs vues sur le Projet Mama, sans rien de propre à ce projet : gestes en boucle, poses de fin
// toutes identiques, texte répété dans chaque prompt, lieux qui changent d'un fichier à l'autre, consignes vidéo pas en anglais.

// Colonnes du fichier à remplir. « prompt_image » et « prompt_video » deviennent la description de la photo et le
// mouvement du plan ; « plan_continu » regroupe les lignes de 5 s qui forment un seul plan à l'écran (même photo) ;
// « debut », « fin », « geste » et « raccord » servent à relire le film (le studio les ignore à l'import).
export const COLONNES_STANDARD = [
  "numero",
  "plan_continu",
  "debut",
  "fin",
  "voix",
  "duree",
  "intention",
  "geste",
  "cadrage",
  "angle",
  "lieu",
  "raccord",
  "pose_debut",
  "pose_fin",
  "prompt_image",
  "prompt_video",
] as const;

type Ref = { nom: string; genre: string; description: string };

// Une ligne d'exemple, avec des noms inventés, montre à l'assistant le format et le niveau de détail attendus.
// Son numéro « EXEMPLE » la fait ignorer à l'import si elle reste dans le fichier.
export const LIGNE_EXEMPLE: Record<(typeof COLONNES_STANDARD)[number], string> = {
  numero: "EXEMPLE",
  plan_continu: "1",
  debut: "00:00",
  fin: "00:05",
  voix: "Tonga soa daholo, ry namana!",
  duree: "5",
  intention: "accueil chaleureux, un peu ému",
  geste: "main droite levée pour saluer",
  cadrage: "plan taille",
  angle: "3/4 gauche",
  lieu: "Jardin",
  raccord: "début de séquence",
  pose_debut: "debout près du portail, mains jointes devant la taille, regard vers la caméra",
  pose_fin: "main droite levée à hauteur d'épaule, large sourire, regard caméra",
  prompt_image:
    "Rova stands at the gate of the Jardin, waist shot, three-quarter left angle. Hands loosely joined in front of her waist, warm expectant smile, eyes toward the camera. Soft late-afternoon light from the left, flowering bushes behind her slightly out of focus.",
  prompt_video:
    "Static camera. 0-1s: Rova takes a small breath and her smile widens. 1-3s: she raises her right hand to shoulder height in a gentle greeting and speaks warmly. 3-4s: she nods slightly, eyes on the camera. 4-5s: she holds the raised hand still, smiling, mouth relaxed.",
};
const cellule = (v: string) => `"${v.replace(/"/g, '""')}"`;
const ligneExemple = () => COLONNES_STANDARD.map((c) => cellule(LIGNE_EXEMPLE[c])).join(";");

// Fichier à remplir par l'assistant : la ligne des colonnes et la ligne d'exemple. Même format que l'import.
export const FICHIER_A_REMPLIR = "tableau_a_remplir.csv";
export const tableauARemplir = () => `${COLONNES_STANDARD.join(";")}\n${ligneExemple()}\n`;

export function promptPreparation(p: {
  titre: string;
  format: string;
  style: string;
  script: string;
  resume?: string;
  categorie: Categorie;
  refs: Ref[];
}) {
  const cat = CATEGORIES[p.categorie];
  const parGenre = (g: string) =>
    p.refs
      .filter((r) => r.genre === g)
      .map((r) => `${r.nom}${r.description ? ` (${r.description})` : ""}`)
      .join(", ") || "(aucun pour l'instant : propose-les en partie A)";
  const colonnes = COLONNES_STANDARD.join(";");

  return `Tu es à la fois réalisateur, scripte et directeur photo sur un film fait entièrement en vidéo générée par IA, plan par plan.
Je te joins : la ou les photos de référence du personnage principal, la voix off du film, et le fichier vide « ${FICHIER_A_REMPLIR} ».
Ta mission : remplir ce fichier avec TOUT ce dont mon studio a besoin pour fabriquer le film, en une seule fois, avec un niveau de qualité professionnel. Je l'importerai tel quel : rien ne sera corrigé à la main après toi.

FILM : « ${p.titre} » — format ${p.format} — catégorie : ${cat.libelle}
RÉSUMÉ / BUT DU FILM : ${p.resume?.trim() || "(non donné : déduis-le de la voix off)"}
STYLE DU FILM (le studio l'ajoute lui-même à chaque photo : ne le répète jamais dans les cellules) : ${p.style.trim() || "(à proposer en partie A)"}
PERSONNAGES (noms à écrire exactement ainsi) : ${parGenre("personnage")}
LIEUX AUTORISÉS (noms à écrire exactement ainsi, aucun autre lieu) : ${parGenre("lieu")}
Si aucun lieu n'est donné : choisis toi-même le MOINS de lieux possible (UN SEUL pour un film de 2 minutes ou moins ; 3 au plus pour 3 minutes), donne-leur un nom court, et utilise uniquement ces noms dans tout le tableau.
${
    p.refs.some((r) => r.genre === "produit")
      ? `PRODUIT À PROMOUVOIR (film de promotion, nom à écrire exactement ainsi) : ${[...new Set(p.refs.filter((r) => r.genre === "produit").map((r) => `${r.nom}${r.description ? ` (${r.description})` : ""}`))].join(", ")}
`
      : ""
  }OBJETS : ${parGenre("objet")}

=== VOIX OFF ===
${p.script.trim() || "Je te la donne juste après cette consigne (ou en fichier joint), telle quelle."}

=== LIGNE D'EXEMPLE (déjà dans le fichier) ===
Le fichier contient une ligne numérotée « EXEMPLE », avec des noms inventés (Rova, Jardin). Elle montre le format exact et le niveau de détail attendu pour CHAQUE ligne, prompts compris :
${COLONNES_STANDARD.join(";")}
${ligneExemple()}
N'en recopie pas le contenu (ni la voix, ni le geste, ni les noms) : chaque plan vient de la voix off du film. Supprime cette ligne dans le fichier que tu me rends.

=== COMMENT MON STUDIO UTILISE TON FICHIER ===
- Chaque ligne = un morceau de 5 s au plus (la limite du modèle vidéo). Le studio crée la photo de départ (Qwen-Image-Edit) à partir de « prompt_image » et des photos de référence, puis l'anime avec « prompt_video » (Wan 2.2, image vers vidéo), sur la durée « duree ».
- PRISE UNIQUE : le studio crée UNE SEULE photo pour tout le film (celle de la ligne 1) ; chaque ligne part de la DERNIÈRE IMAGE de la vidéo précédente, sur tout le film : aucune coupe. « plan_continu » : les lignes qui se suivent avec le même numéro gardent le même cadrage, caméra fixe. Un nouveau numéro = un nouveau cadrage, atteint par un lent mouvement de caméra AU MILIEU de sa première ligne, jamais par une coupe. Numérote 1, 2, 3… dans l'ordre.
- Une photo de référence n'est utilisée que si son nom est écrit dans « prompt_image » ou dans « lieu ». Au maximum 3 références par plan (par exemple 2 personnages + 1 lieu).
- Le studio ajoute LUI-MÊME à chaque photo : même visage, même âge, même tenue que la référence, style du film, image plein cadre sans texte ni bande floue, anatomie correcte des mains. Et à chaque vidéo : visage stable, gestes naturels, pas de déformation.
- Donc tes cellules ne contiennent QUE ce qui est propre au plan. Jamais de phrase générale recopiée de ligne en ligne (« photorealistic », « 4K », « same face », « cinematic lighting »…).
- Après l'import, le studio signale automatiquement : gestes répétés sur 10 lignes voisines, même cadrage + angle pour deux plans continus de suite, plan continu trop court ou trop long pour la catégorie, voix trop longue pour la durée, consignes vidéo pas en anglais. Vise zéro alerte.

=== RÈGLES ABSOLUES, VALABLES POUR TOUT LE FILM (elles passent avant toutes les autres) ===
1. COMPRENDRE AVANT D'AGIR. Lis et comprends toute la voix off, puis chaque réplique, AVANT de décider quoi que ce soit. Chaque geste, chaque mouvement de caméra, chaque changement de cadrage, de lieu ou de personnage doit venir de ce que dit le texte à ce moment précis. Si le texte ne le demande pas, rien ne change : la personne continue de parler dans le même cadre.
2. PRISE UNIQUE. Chaque vidéo commence par la DERNIÈRE IMAGE de la vidéo précédente, du début à la fin du film, y compris avant un changement de lieu ou de personnage. Aucune coupe, jamais.
3. CATÉGORIE. Respecte les règles de la catégorie « ${cat.libelle} » données plus bas : elles fixent le rythme du film.
4. CHANGEMENTS RARES ET AU MILIEU. Un zoom, un changement de cadrage, de lieu ou de personnage n'arrive que s'il est vraiment nécessaire, donc rarement. Il se fait toujours AU MILIEU de la ligne (pour une ligne de 5 s : entre 1 s et 4 s), jamais pendant la première ni pendant la dernière seconde : chaque ligne commence et finit sur une image calme, pour que le raccord avec la ligne d'avant et celle d'après ne se voie pas.

=== ÉTAPE 1 — ANALYSE (dans ta tête, avant d'écrire) ===
Lis le résumé et toute la voix off. Repère l'histoire, les moments forts, les changements d'émotion et les séquences (groupes de plans dans un même lieu et une même lumière). Décide la carte des lieux, l'ordre des séquences, puis les PLANS CONTINUS : regroupe d'abord la voix off en blocs de sens (une idée, un moment), un plan continu par bloc, et seulement ensuite coupe chaque bloc en lignes de 5 s au plus. Ce plan d'ensemble guide tout le tableau : un film, pas une suite de morceaux de 5 s.

=== ${cat.libelle.toUpperCase()} : RÈGLES PROPRES À CE FILM (elles passent avant les règles générales) ===
${cat.consigne}

=== GRAMMAIRE DU DÉCOUPAGE (comme un vrai réalisateur) ===
- SÉQUENCE = un lieu + un moment + un sujet. Tant que le lieu, l'heure et le sujet ne changent pas, on reste dans la même séquence et dans le même lieu.
- On CHANGE DE LIEU seulement si l'histoire change de temps, de lieu réel ou d'action (on part ailleurs, le lendemain…). Jamais pour « faire varier », jamais au milieu d'une phrase ou d'une idée. Un témoignage, une interview, une personne qui raconte un souvenir : un seul lieu pour tout le film.
- PLAN CONTINU ≠ LIGNE. La limite de 5 s est technique : elle ne doit jamais se voir. On ne change pas de cadrage parce que 5 s sont passées ; on en change quand le texte le demande (voir la catégorie ci-dessus). Tant que le cadrage ne change pas, les lignes gardent le même plan_continu.
- On CHANGE DE CADRAGE (plan large → plan taille → plan rapproché → gros plan) seulement en changeant de plan continu, par un lent mouvement de caméra (voir les règles de la catégorie). Une séquence s'ouvre en général par un plan plus large, puis se resserre au fil de l'émotion.
- Deux plans continus qui se suivent changent au moins le cadrage ou l'angle, sinon le mouvement de caméra ne sert à rien. Dans un même plan continu, au contraire, rien ne change : même cadrage, même angle, même photo.
- On GARDE L'AXE : la caméra reste du même côté de la personne pendant toute la séquence (règle des 180°), le regard part toujours du même côté.
- RYTHME : il dépend de la catégorie (durée des plans continus donnée plus haut : ${cat.planMin} à ${cat.planMax} s).
- Dans un même lieu, la pièce, les meubles, les objets et la lumière ne bougent jamais : seuls le cadrage, l'angle, la pose et le geste changent.
- Un film de 1 à 2 minutes est trop court pour changer de lieu : UN SEUL lieu. Ce qui fait vivre le film, c'est le GESTE (et le cadrage), pas le décor.${
    p.refs.some((r) => r.genre === "produit")
      ? `
- FILM DE PROMOTION : le produit est la vedette. Il apparaît clairement dès qu'on en parle, et au moins dans le premier plan où il est cité, dans un gros plan du produit seul et dans le plan de fin. Écris son nom exact dans « prompt_image » de chaque plan où il est visible (sinon sa photo n'est pas utilisée). Les gestes le montrent et l'utilisent (le présenter, l'allumer, poser la casserole dessus…), mains bien visibles, sans le cacher. Il ne change jamais de forme, de couleur ni de logo.`
      : ""
  }

=== ÉTAPE 2 — RÈGLES DU TABLEAU ===
1. DÉCOUPAGE. Découpe toi-même la voix off en lignes, dans l'ordre : une ligne = une réplique, ou un morceau de réplique coupé à une pause naturelle (fin de phrase, virgule, respiration). Chaque mot prononcé apparaît une seule fois dans « voix », sans traduction, correction ni oubli, dans sa langue d'origine. Les titres, numéros, noms de locuteur et indications de mise en scène ne sont pas des paroles : ne les mets pas dans « voix », sers-t'en pour l'intention et les gestes. Un plan sans parole (respiration, regard, transition) est permis : « voix » vide.
2. NUMÉRO, DURÉE, MINUTAGE. « numero » : 1, 2, 3… sans trou. « duree » en secondes, nombre entier, JAMAIS plus de 5 : le modèle vidéo est fait pour des clips de 5 s, au-delà l'image se dégrade. 5 par défaut ; 3 ou 4 si la parole est très courte (mots ÷ 2,5, plus 1 s de respiration). Une parole de plus de 12 mots (2,5 mots par seconde) se coupe en deux lignes ou plus, à une pause naturelle (virgule, « ary », « dia », « fa »…), sans couper un mot ni un nom ; en général ces lignes restent dans le même plan continu (même numéro, même cadrage, même photo). « debut » et « fin » : minutage du plan dans le film, au format mm:ss (le premier plan commence à 00:00, chaque plan commence à la fin du précédent).
3. INTENTION ET GESTE. « intention » : l'émotion précise du moment, en français, tirée du sens de la réplique (pas « joie » partout : tendresse, fierté amusée, inquiétude retenue…). « geste » : le geste principal du plan en quelques mots, en français (le même que dans « prompt_video »).
4. CADRAGE ET ANGLE. « cadrage » parmi : ${CADRAGES.join(", ")}. « angle » parmi : ${ANGLES.join(", ")}. Écris-les exactement ainsi. Toutes les lignes d'un plan continu ont le même cadrage et le même angle. Jamais le même couple cadrage + angle pour deux plans continus qui se suivent. Plans serrés (gros plan, plan rapproché) pour l'émotion forte, plans larges pour ouvrir une séquence ou changer de lieu. Pendant que le personnage parle : face ou 3/4, jamais de dos ni de profil strict.
5. LIEU. Uniquement un nom de la liste des lieux autorisés, écrit exactement pareil. Comme un vrai tournage : le MOINS de lieux possible et de longues séquences dans chaque lieu (au moins 6 plans, souvent tout le film). D'un plan à l'autre dans un lieu, seuls le cadrage, l'angle et le geste changent ; la pièce, les meubles, la lumière et l'heure restent identiques. On change de lieu seulement quand le sujet change vraiment, JAMAIS au milieu d'une phrase ni d'une idée. Un témoignage ou une interview reste dans un seul lieu : quand la personne raconte un souvenir ailleurs, elle le raconte depuis ce lieu (pas de saut vers le lieu du souvenir). Quand le lieu change vraiment, la ligne part de la dernière image dans l'ancien lieu : écris dans son prompt_video comment on y va, au milieu de la ligne (la personne marche vers la porte, la caméra la suit dans la pièce voisine…). De même, un personnage qui arrive entre dans le cadre ou est rejoint par la caméra au milieu d'une ligne, il n'apparaît jamais d'un coup.
6. POSES ET RACCORDS. « pose_debut » et « pose_fin » : position précise du corps, de la tête, du regard et des deux mains, en français. « raccord » : comment la ligne s'enchaîne à la précédente, un choix parmi « début de séquence » (ligne 1), « même plan » (ligne qui continue le plan continu précédent) ou « mouvement de caméra » (première ligne d'un nouveau plan continu : lent rapprochement ou recul vers le nouveau cadrage, au milieu de la ligne). SUR TOUT LE FILM, chaque ligne commence exactement là où finit la précédente (pose_debut = pose_fin de la ligne précédente, mot pour mot) : le studio part de la dernière image de la vidéo précédente. Chaque ligne finit sur une pose calme et stable (mains posées ou immobiles, visage vers la caméra), jamais au milieu d'un geste rapide, pour que la suite reparte proprement. Après 3 ou 4 lignes, reviens à une pose proche de celle de la photo du plan (le visage reste ainsi fidèle).
7. « prompt_image » = PROMPT DE LA PHOTO DE DÉPART, EN ANGLAIS, 30 à 70 mots. Il est identique mot pour mot sur TOUTES les lignes du film et décrit le début de la ligne 1 (une seule photo est créée pour tout le film). L'instant figé au tout début du plan : qui (nom exact), où (nom exact du lieu), la pose_debut, l'expression du visage, le cadrage et l'angle, la lumière de la séquence. Aucun verbe de mouvement, aucune suite d'actions, aucun texte écrit dans l'image. Le décor vient de la photo du lieu : ne le décris pas à nouveau, et surtout n'invente rien d'un plan à l'autre (pas de nouveau banc, de nouvelles fleurs, de colonnes, d'autre couleur de ciel ou d'autre heure) ; au plus quelques mots sur ce que l'on voit derrière la personne dans CE cadrage. Si plusieurs personnages : qui est où dans le cadre et qui parle. Pas de phrase toute faite recopiée au début ou à la fin de chaque prompt (le studio ajoute déjà le style et les règles générales) : décris ce qui est propre au plan.
8. « prompt_video » = PROMPT DE LA VIDÉO, EN ANGLAIS, 40 à 80 mots, découpé en temps : "0-1s: … 1-3s: … 3-4s: … 4-5s: …" jusqu'à la durée du plan. Un seul geste principal, qui vient du sens de la réplique (pas un geste décoratif). Quand il y a une parole : "she speaks softly", "he says warmly"… pour animer la bouche. La dernière tranche arrive exactement sur la pose_fin, tenue immobile pendant la dernière demi-seconde. Dans un plan continu, la première tranche des lignes suivantes reprend exactement le mouvement là où il s'est arrêté ("continues from the previous pose"). Caméra fixe, sauf dans la première ligne de chaque nouveau plan continu : un lent mouvement ("slow push-in", rarement "slow pull-back") AU MILIEU de la ligne, pendant que la personne continue de parler (par exemple "0-1s: camera still, … 1-4s: the camera slowly pushes in to a chest-up shot while she speaks … 4-5s: camera still, …"), jamais dans la première ni la dernière seconde. Sur tout le film, la première tranche de chaque ligne reprend exactement là où la précédente s'est arrêtée. Aucun geste repris dans les 10 lignes voisines. Ce qui donne vie au plan, c'est le geste des mains, le regard, l'expression du visage et, au besoin, un léger zoom : jamais un changement de décor. Termine par ce qui bouge doucement dans le fond du lieu, s'il y en a (feuilles et fleurs dans le vent, nuages qui passent, eau ou cascade qui coule, voilage qui flotte) : "Background: …". La première tranche (0-1s) décrit le départ propre à ce plan (pose, regard, respiration selon l'émotion) : jamais la même phrase d'un plan à l'autre.
9. CE QUE L'IA VIDÉO RATE (à éviter) : mains devant le visage ou la bouche pendant la parole, bras croisés, doigts entremêlés, mains qui se touchent longtemps, manger ou boire, objets qui apparaissent, personnage qui sort du cadre ou se retourne complètement en parlant, gestes rapides, plus de deux actions en 5 s, foule, reflets dans un miroir, texte à l'écran.
10. Toutes les cellules sont remplies, prompts compris (sauf « voix » d'un plan sans parole). Jamais « à définir », « idem », « … » ni « etc. ». Un fichier sans prompt_image ou prompt_video est inutilisable.

=== ÉTAPE 3 — VÉRIFICATION AVANT DE RENDRE ===
Relis tout le tableau et corrige-le jusqu'à ce que tout soit vrai :
- La voix off complète se retrouve dans « voix », mot pour mot, dans l'ordre, sans doublon.
- Aucune phrase identique au début ou à la fin de tous les prompt_image ou de tous les prompt_video.
- Numéros continus ; aucune durée au-dessus de 5 ; chaque durée tient sa parole (mots ÷ 2,5 ≤ durée) ; « debut » et « fin » se suivent sans trou.
- « plan_continu » rempli sur chaque ligne (1, 2, 3… dans l'ordre) ; durée de chaque plan continu (somme de ses lignes) entre ${cat.planMin} et ${cat.planMax} s ; aucun changement de cadrage au milieu d'une phrase.
- Dans chaque plan continu : même cadrage, même angle, même lieu, même prompt_image mot pour mot, chaque pose_debut reprend mot pour mot la pose_fin de la ligne précédente, caméra fixe.
- Prise unique : prompt_image identique sur tout le film ; chaque pose_debut reprend la pose_fin de la ligne précédente, sur tout le film ; la première ligne de chaque nouveau plan continu a son mouvement de caméra AU MILIEU de la ligne, jamais dans la première ni la dernière seconde.
- Chaque geste, mouvement de caméra, changement de cadrage, de lieu ou de personnage vient du sens de la réplique à ce moment-là ; s'il n'est pas vraiment nécessaire, supprime-le.
- Aucun couple cadrage + angle répété pour deux plans continus de suite ; aucun geste répété dans 10 lignes voisines.
- Le moins de lieux possible (un seul pour 2 minutes ou moins) ; aucun changement de lieu au milieu d'une phrase ; aucun lieu tenu un seul plan ; même pièce, même lumière dans tout un lieu.
- « prompt_image » et « prompt_video » remplis sur CHAQUE ligne, en anglais, sans phrase générale recopiée ; noms des personnages et des lieux exactement comme dans les listes ; au plus 3 références citées par plan.
- Le fichier est complet jusqu'au dernier plan, quel que soit le nombre de plans.

=== RÉPONSE ATTENDUE ===
A. Avant le fichier, seulement si besoin : les personnages ou lieux à créer (nom + description courte en français pour que je prépare leur photo), et une proposition de style si aucun n'est donné (une phrase, en anglais).
B. Le fichier « ${FICHIER_A_REMPLIR} » rempli, à télécharger (crée-le avec ton outil de fichiers ou d'analyse : c'est le seul moyen sûr pour un long film). Format exact : CSV, encodage UTF-8, séparateur point-virgule, chaque cellule entre guillemets doubles (un guillemet dans le texte s'écrit ""), aucune ligne vide, aucune autre colonne, première ligne :
${colonnes}
Si tu ne peux pas créer de fichier : le même contenu dans UN SEUL bloc de code CSV ; si c'est trop long pour un message, continue dans le message suivant sans répéter la première ligne, jusqu'au dernier plan.
C. Après le fichier : le nombre de lignes, le nombre de plans continus et la durée totale, puis les 3 plans les plus risqués (visage, mains, raccord) et pourquoi, en une phrase chacun.`;
}
