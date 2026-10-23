import { ANGLES, CADRAGES } from "@/lib/libelles";

// Prompt de préparation : à coller dans un assistant gratuit (ChatGPT, Claude, Gemini…) avec la photo principale.
// Il transforme une voix off en tableau de plans au format standard du studio, prêt à importer (CSV).
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
Je te joins la ou les photos de référence du personnage principal. Prépare le tableau des plans du film au format standard de mon studio.

FILM : « ${p.titre} » — format ${p.format}
STYLE DU FILM (déjà ajouté automatiquement à chaque photo, ne le répète pas) : ${p.style.trim() || "(à proposer)"}
PERSONNAGES (noms à citer tels quels) : ${parGenre("personnage")}
LIEUX AUTORISÉS (noms à utiliser tels quels, aucun autre lieu) : ${parGenre("lieu")}
OBJETS : ${parGenre("objet")}

=== VOIX OFF / DIALOGUES ===
${p.script.trim() || "[COLLEZ ICI LA VOIX OFF, une réplique par ligne]"}

=== COMMENT FONCTIONNE MON STUDIO ===
- Chaque plan = une photo de départ créée à partir des références (Qwen-Image-Edit), puis animée 5 s par Wan 2.2 « image vers vidéo ».
- Le studio ajoute LUI-MÊME à chaque photo : le respect du visage, de l'âge et de la tenue, le style du film, le plein cadre sans texte ni bande floue, l'anatomie des mains. Et à chaque vidéo : visage stable, gestes subtils, pas de déformation.
- Donc tes colonnes ne contiennent QUE ce qui est propre au plan. Ne répète jamais ces règles générales dans les cellules.

=== RÈGLES DU TABLEAU ===
1. Une ligne par réplique, dans l'ordre. Le texte de « voix » est recopié à l'identique, sans traduction ni correction.
2. « duree » en secondes : 5 par défaut ; plus si la réplique dépasse environ 12 mots (2,5 mots par seconde), au maximum 10 ; sinon découpe en deux plans.
3. « intention » : l'émotion du moment, en français, en lien avec le sens de la réplique.
4. « cadrage » parmi : ${CADRAGES.join(", ")}. « angle » parmi : ${ANGLES.join(", ")}. Jamais le même couple cadrage + angle deux plans de suite ; varie sur l'ensemble du film.
5. « lieu » : uniquement un nom de la liste des lieux autorisés. Garde le même lieu sur des groupes de plans qui se suivent ; change de lieu seulement à un moment fort.
6. « pose_debut » et « pose_fin » : position précise du corps, de la tête, du regard et des mains. Chaque pose_fin est différente. La pose_debut d'un plan enchaîne avec la pose_fin du plan précédent, sauf coupe franche voulue (changement net de cadrage).
7. « description » EN ANGLAIS : l'instant figé au tout début du plan (la photo de départ) : qui, où, pose, expression, cadrage. Cite le nom du personnage et du lieu tels qu'écrits plus haut. 40 mots maximum.
8. « mouvement » EN ANGLAIS, découpé ainsi : "0-1s: … 1-3s: … 3-4s: … 4-5s: …" (adapter si la durée est plus longue). Un seul geste principal qui correspond au sens de la réplique, réalisable dans la durée, caméra fixe ou mouvement très léger. Pas de geste recopié d'un plan à l'autre : chaque geste vient de la réplique. 50 mots maximum.
9. Bouche toujours visible pendant que le personnage parle ; pas de main devant le visage.

=== RÉPONSE ATTENDUE ===
A. Si des lieux ou personnages manquent : la liste à créer (nom + description courte), avant le tableau.
B. Le tableau complet, dans UN SEUL bloc de code CSV, séparateur point-virgule, avec exactement cette première ligne :
${COLONNES_STANDARD.join(";")}
Mets chaque cellule entre guillemets doubles. Aucune autre colonne, aucune ligne vide, aucun commentaire dans le bloc.
C. Après le bloc : les 3 plans les plus risqués (visage, mains, raccord) et pourquoi, en une phrase chacun.

Je copierai le bloc CSV dans un fichier .csv et je l'importerai tel quel dans le studio.`;
}
