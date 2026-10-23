import { ANGLES, CADRAGES } from "@/lib/libelles";

// Prompt de préparation : à coller dans un assistant gratuit (ChatGPT, Claude, Gemini…) avec la photo principale.
// Il découpe la voix off en plans et remplit le fichier vide du studio (format standard, CSV), qui se réimporte tel quel.
// Les règles reprennent les erreurs vues sur le Projet Mama, sans rien de propre à ce projet : gestes en boucle, poses de fin
// toutes identiques, texte répété dans chaque prompt, lieux qui changent d'un fichier à l'autre, consignes vidéo pas en anglais.

// Colonnes du fichier à remplir. « prompt_image » et « prompt_video » deviennent la description de la photo et le
// mouvement du plan ; « debut », « fin », « geste » et « raccord » servent à relire le film (le studio les ignore à l'import).
export const COLONNES_STANDARD = [
  "numero",
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

// Fichier à remplir par ChatGPT : seulement la ligne des colonnes. Même format que l'import, il se réimporte tel quel.
export const FICHIER_A_REMPLIR = "tableau_a_remplir.csv";
export const tableauARemplir = () => COLONNES_STANDARD.join(";") + "\n";

export function promptPreparation(p: {
  titre: string;
  format: string;
  style: string;
  script: string;
  resume?: string;
  refs: Ref[];
}) {
  const parGenre = (g: string) =>
    p.refs
      .filter((r) => r.genre === g)
      .map((r) => `${r.nom}${r.description ? ` (${r.description})` : ""}`)
      .join(", ") || "(aucun pour l'instant : propose-les en partie A)";
  const colonnes = COLONNES_STANDARD.join(";");

  return `Tu es à la fois réalisateur, scripte et directeur photo sur un film fait entièrement en vidéo générée par IA, plan par plan.
Je te joins : la ou les photos de référence du personnage principal, la voix off du film, et le fichier vide « ${FICHIER_A_REMPLIR} ».
Ta mission : remplir ce fichier avec TOUT ce dont mon studio a besoin pour fabriquer le film, en une seule fois, avec un niveau de qualité professionnel. Je l'importerai tel quel : rien ne sera corrigé à la main après toi.

FILM : « ${p.titre} » — format ${p.format}
RÉSUMÉ / BUT DU FILM : ${p.resume?.trim() || "(non donné : déduis-le de la voix off)"}
STYLE DU FILM (le studio l'ajoute lui-même à chaque photo : ne le répète jamais dans les cellules) : ${p.style.trim() || "(à proposer en partie A)"}
PERSONNAGES (noms à écrire exactement ainsi) : ${parGenre("personnage")}
LIEUX AUTORISÉS (noms à écrire exactement ainsi, aucun autre lieu) : ${parGenre("lieu")}
Si aucun lieu n'est donné : choisis toi-même 2 à 5 lieux qui servent l'histoire et le résumé, donne-leur un nom court, et utilise uniquement ces noms dans tout le tableau.
OBJETS : ${parGenre("objet")}

=== VOIX OFF ===
${p.script.trim() || "Je te la donne juste après cette consigne (ou en fichier joint), telle quelle."}

=== COMMENT MON STUDIO UTILISE TON FICHIER ===
- Chaque ligne = un plan. Le studio crée d'abord la photo de départ (Qwen-Image-Edit) à partir de « prompt_image » et des photos de référence, puis l'anime avec « prompt_video » (Wan 2.2, image vers vidéo), sur la durée « duree ».
- Une photo de référence n'est utilisée que si son nom est écrit dans « prompt_image » ou dans « lieu ». Au maximum 3 références par plan (par exemple 2 personnages + 1 lieu).
- Le studio ajoute LUI-MÊME à chaque photo : même visage, même âge, même tenue que la référence, style du film, image plein cadre sans texte ni bande floue, anatomie correcte des mains. Et à chaque vidéo : visage stable, gestes naturels, pas de déformation.
- Donc tes cellules ne contiennent QUE ce qui est propre au plan. Jamais de phrase générale recopiée de ligne en ligne (« photorealistic », « 4K », « same face », « cinematic lighting »…).
- Après l'import, le studio signale automatiquement : gestes ou poses de fin répétés sur 10 plans voisins, même cadrage + angle deux plans de suite, voix trop longue pour la durée, consignes vidéo pas en anglais. Vise zéro alerte.

=== ÉTAPE 1 — ANALYSE (dans ta tête, avant d'écrire) ===
Lis le résumé et toute la voix off. Repère l'histoire, les moments forts, les changements d'émotion et les séquences (groupes de plans dans un même lieu et une même lumière). Décide la carte des lieux et l'ordre des séquences. Ce plan d'ensemble guide tout le tableau : un film, pas une suite de plans isolés.

=== ÉTAPE 2 — RÈGLES DU TABLEAU ===
1. DÉCOUPAGE. Découpe toi-même la voix off en plans, dans l'ordre : un plan = une réplique, ou un morceau de réplique coupé à une pause naturelle (fin de phrase, virgule, respiration). Chaque mot prononcé apparaît une seule fois dans « voix », sans traduction, correction ni oubli, dans sa langue d'origine. Les titres, numéros, noms de locuteur et indications de mise en scène ne sont pas des paroles : ne les mets pas dans « voix », sers-t'en pour l'intention et les gestes. Un plan sans parole (respiration, regard, transition) est permis : « voix » vide.
2. NUMÉRO, DURÉE, MINUTAGE. « numero » : 1, 2, 3… sans trou. « duree » en secondes, nombre entier : 5 par défaut ; plus si la parole dépasse 12 mots (2,5 mots par seconde), au maximum 10 ; au-delà, coupe en deux plans. « debut » et « fin » : minutage du plan dans le film, au format mm:ss (le premier plan commence à 00:00, chaque plan commence à la fin du précédent).
3. INTENTION ET GESTE. « intention » : l'émotion précise du moment, en français, tirée du sens de la réplique (pas « joie » partout : tendresse, fierté amusée, inquiétude retenue…). « geste » : le geste principal du plan en quelques mots, en français (le même que dans « prompt_video »).
4. CADRAGE ET ANGLE. « cadrage » parmi : ${CADRAGES.join(", ")}. « angle » parmi : ${ANGLES.join(", ")}. Écris-les exactement ainsi. Jamais le même couple cadrage + angle deux plans de suite. Varie sur tout le film : aucun cadrage sur plus d'un tiers des plans. Plans serrés (gros plan, plan rapproché) pour l'émotion forte, plans larges pour ouvrir une séquence ou changer de lieu. Pendant que le personnage parle : face ou 3/4, jamais de dos ni de profil strict.
5. LIEU. Uniquement un nom de la liste des lieux autorisés, écrit exactement pareil. Même lieu et même lumière (heure du jour) sur toute une séquence ; on ne change de lieu qu'à un moment fort.
6. POSES ET RACCORDS. « pose_debut » et « pose_fin » : position précise du corps, de la tête, du regard et des deux mains, en français. « raccord » : comment ce plan s'enchaîne au précédent, un choix parmi « début de séquence », « même axe » (la pose_debut reprend exactement la pose_fin du plan précédent) ou « coupe franche » (changement net de cadrage ou d'angle, la pose peut changer). Chaque pose_fin est différente de toutes les autres du film.
7. « prompt_image » = PROMPT DE LA PHOTO DE DÉPART, EN ANGLAIS, 30 à 70 mots. L'instant figé au tout début du plan : qui (nom exact), où (nom exact du lieu), la pose_debut, l'expression du visage, le cadrage et l'angle, la lumière de la séquence. Aucun verbe de mouvement, aucune suite d'actions, aucun texte écrit dans l'image. Si plusieurs personnages : qui est où dans le cadre et qui parle.
8. « prompt_video » = PROMPT DE LA VIDÉO, EN ANGLAIS, 40 à 80 mots, découpé en temps : "0-1s: … 1-3s: … 3-4s: … 4-5s: …" jusqu'à la durée du plan. Un seul geste principal, qui vient du sens de la réplique (pas un geste décoratif). Quand il y a une parole : "she speaks softly", "he says warmly"… pour animer la bouche. La dernière tranche arrive exactement sur la pose_fin. Caméra fixe par défaut ; au plus un plan sur quatre avec un mouvement très léger (slow push-in, slight pan). Aucun geste repris dans les 10 plans voisins.
9. CE QUE L'IA VIDÉO RATE (à éviter) : mains devant le visage ou la bouche pendant la parole, bras croisés, doigts entremêlés, mains qui se touchent longtemps, manger ou boire, objets qui apparaissent, personnage qui sort du cadre ou se retourne complètement en parlant, gestes rapides, plus de deux actions en 5 s, foule, reflets dans un miroir, texte à l'écran.
10. Toutes les cellules sont remplies, prompts compris (sauf « voix » d'un plan sans parole). Jamais « à définir », « idem », « … » ni « etc. ». Un fichier sans prompt_image ou prompt_video est inutilisable.

=== ÉTAPE 3 — VÉRIFICATION AVANT DE RENDRE ===
Relis tout le tableau et corrige-le jusqu'à ce que tout soit vrai :
- La voix off complète se retrouve dans « voix », mot pour mot, dans l'ordre, sans doublon.
- Numéros continus ; chaque durée tient sa parole (mots ÷ 2,5 ≤ durée) ; « debut » et « fin » se suivent sans trou.
- Aucun couple cadrage + angle répété deux plans de suite ; aucun geste ni pose_fin répété dans 10 plans voisins ; aucune pose_fin identique dans tout le film.
- Chaque pose_debut raccorde avec la pose_fin précédente, ou la coupe franche est évidente.
- « prompt_image » et « prompt_video » remplis sur CHAQUE ligne, en anglais, sans phrase générale recopiée ; noms des personnages et des lieux exactement comme dans les listes ; au plus 3 références citées par plan.
- Le fichier est complet jusqu'au dernier plan, quel que soit le nombre de plans.

=== RÉPONSE ATTENDUE ===
A. Avant le fichier, seulement si besoin : les personnages ou lieux à créer (nom + description courte en français pour que je prépare leur photo), et une proposition de style si aucun n'est donné (une phrase, en anglais).
B. Le fichier « ${FICHIER_A_REMPLIR} » rempli, à télécharger (crée-le avec ton outil de fichiers ou d'analyse : c'est le seul moyen sûr pour un long film). Format exact : CSV, encodage UTF-8, séparateur point-virgule, chaque cellule entre guillemets doubles (un guillemet dans le texte s'écrit ""), aucune ligne vide, aucune autre colonne, première ligne :
${colonnes}
Si tu ne peux pas créer de fichier : le même contenu dans UN SEUL bloc de code CSV ; si c'est trop long pour un message, continue dans le message suivant sans répéter la première ligne, jusqu'au dernier plan.
C. Après le fichier : le nombre de plans et la durée totale, puis les 3 plans les plus risqués (visage, mains, raccord) et pourquoi, en une phrase chacun.`;
}
