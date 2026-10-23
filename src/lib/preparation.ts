import { ANGLES, CADRAGES } from "@/lib/libelles";

// Prompt de préparation : à coller dans un assistant gratuit (ChatGPT, Claude, Gemini…) avec la photo principale.
// Il découpe la voix off en plans et remplit le fichier vide du studio (format standard, CSV), qui se réimporte tel quel.
// Les règles reprennent les erreurs vues sur le Projet Mama : gestes en boucle, poses de fin toutes identiques,
// texte répété dans chaque prompt, lieux qui changent d'un fichier à l'autre, consignes vidéo pas en anglais.

export const COLONNES_STANDARD = [
  "numero",
  "voix",
  "duree",
  "intention",
  "cadrage",
  "angle",
  "lieu",
  "pose_debut",
  "description",
  "mouvement",
  "pose_fin",
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
  refs: Ref[];
}) {
  const parGenre = (g: string) =>
    p.refs
      .filter((r) => r.genre === g)
      .map((r) => `${r.nom}${r.description ? ` (${r.description})` : ""}`)
      .join(", ") || "(aucune pour l'instant : propose-en dans ta réponse, avant le tableau)";

  return `Tu es réalisateur et scripte sur un film fait entièrement en vidéo générée par IA, image par image.
Je te joins la ou les photos de référence du personnage principal, la voix off et le fichier à remplir. Prépare le tableau des plans du film au format standard de mon studio.

FILM : « ${p.titre} » — format ${p.format}
STYLE DU FILM (déjà ajouté automatiquement à chaque photo, ne le répète pas) : ${p.style.trim() || "(à proposer)"}
PERSONNAGES (noms à citer tels quels) : ${parGenre("personnage")}
LIEUX AUTORISÉS (noms à utiliser tels quels, aucun autre lieu) : ${parGenre("lieu")}
OBJETS : ${parGenre("objet")}

=== VOIX OFF ===
${p.script.trim() || "Je te la donne juste après cette consigne (ou en fichier joint), telle quelle."}

=== FICHIER À REMPLIR ===
Je te joins aussi le fichier vide « ${FICHIER_A_REMPLIR} ». Sa première ligne contient les colonnes : ${COLONNES_STANDARD.join(";")}
Remplis-le : une ligne par plan.

=== COMMENT FONCTIONNE MON STUDIO ===
- Chaque plan = une photo de départ créée à partir des références (Qwen-Image-Edit), puis animée 5 s par Wan 2.2 « image vers vidéo ».
- Le studio ajoute LUI-MÊME à chaque photo : le respect du visage, de l'âge et de la tenue, le style du film, le plein cadre sans texte ni bande floue, l'anatomie des mains. Et à chaque vidéo : visage stable, gestes subtils, pas de déformation.
- Donc tes colonnes ne contiennent QUE ce qui est propre au plan. Ne répète jamais ces règles générales dans les cellules.

=== RÈGLES DU TABLEAU ===
1. Découpe toi-même la voix off en plans, dans l'ordre : un plan = une réplique, ou un morceau de réplique coupé à une pause naturelle (fin de phrase, virgule). Chaque mot prononcé apparaît une seule fois dans « voix », sans traduction, correction ni oubli. Les titres, numéros et indications de mise en scène ne sont pas des paroles : ne les mets pas dans « voix », sers-t'en pour l'intention et les gestes.
2. « numero » : 1, 2, 3… sans trou. « duree » en secondes : 5 par défaut ; plus si le texte dépasse environ 12 mots (2,5 mots par seconde), au maximum 10 ; au-delà, coupe en deux plans.
3. « intention » : l'émotion du moment, en français, en lien avec le sens de la réplique.
4. « cadrage » parmi : ${CADRAGES.join(", ")}. « angle » parmi : ${ANGLES.join(", ")}. Jamais le même couple cadrage + angle deux plans de suite ; varie sur l'ensemble du film.
5. « lieu » : uniquement un nom de la liste des lieux autorisés. Garde le même lieu sur des groupes de plans qui se suivent ; change de lieu seulement à un moment fort.
6. « pose_debut » et « pose_fin » : position précise du corps, de la tête, du regard et des mains. Chaque pose_fin est différente. La pose_debut d'un plan enchaîne avec la pose_fin du plan précédent, sauf coupe franche voulue (changement net de cadrage).
7. « description » EN ANGLAIS : l'instant figé au tout début du plan (la photo de départ) : qui, où, pose, expression, cadrage. Cite le nom du personnage et du lieu tels qu'écrits plus haut. 40 mots maximum.
8. « mouvement » EN ANGLAIS, découpé ainsi : "0-1s: … 1-3s: … 3-4s: … 4-5s: …" (adapter si la durée est plus longue). Un seul geste principal qui correspond au sens de la réplique, réalisable dans la durée, caméra fixe ou mouvement très léger. Pas de geste recopié d'un plan à l'autre : chaque geste vient de la réplique. 50 mots maximum.
9. Bouche toujours visible pendant que le personnage parle ; pas de main devant le visage.

=== RÉPONSE ATTENDUE ===
A. Si des lieux ou personnages manquent : la liste à créer (nom + description courte), avant le tableau.
B. Le fichier « ${FICHIER_A_REMPLIR} » rempli, à télécharger. Donne aussi son contenu dans UN SEUL bloc de code CSV (au cas où le fichier ne s'ouvre pas) : séparateur point-virgule, même première ligne :
${COLONNES_STANDARD.join(";")}
Mets chaque cellule entre guillemets doubles. Aucune autre colonne, aucune ligne vide, aucun commentaire dans le bloc.
C. Après le bloc : les 3 plans les plus risqués (visage, mains, raccord) et pourquoi, en une phrase chacun.

Je réimporterai le fichier .csv tel quel dans le studio.`;
}
