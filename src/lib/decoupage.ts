export type SceneDecoupee = { voix: string; mouvement: string };

const ENTETE = /^\s*(?:#{1,3}\s*)?(?:sc[eè]ne|scene|plan|s[eé]quence)\s*\d*\b.*$/i;
const SEPARATEUR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const MOUVEMENT = /^\s*(?:mouvement|motion|prompt|cam[eé]ra|action)\s*:\s*/i;
const VOIX = /^\s*(?:voix(?:\s*off)?|vo|narration|texte)\s*:\s*/i;

// Découpe un script en scènes. Les scènes sont séparées par des lignes « Scène 1 », « Plan 2 »… ou « --- ».
// Sans ces repères, chaque paragraphe devient une scène.
// Dans une scène, une ligne « Mouvement : … » donne le mouvement voulu ; le reste est le texte de la voix off.
export function decouperScript(texte: string): SceneDecoupee[] {
  const lignes = texte.replace(/\r\n?/g, "\n").split("\n");
  const avecReperes = lignes.some((l) => ENTETE.test(l) || SEPARATEUR.test(l));

  const blocs: string[][] = [];
  let courant: string[] = [];
  const fermer = () => {
    if (courant.some((l) => l.trim())) blocs.push(courant);
    courant = [];
  };
  for (const ligne of lignes) {
    if (avecReperes ? ENTETE.test(ligne) || SEPARATEUR.test(ligne) : !ligne.trim()) fermer();
    else courant.push(ligne);
  }
  fermer();

  return blocs.map((bloc) => {
    const voix: string[] = [];
    const mouvement: string[] = [];
    for (const l of bloc) {
      if (MOUVEMENT.test(l)) mouvement.push(l.replace(MOUVEMENT, ""));
      else if (l.trim()) voix.push(l.replace(VOIX, "").trim());
    }
    return { voix: voix.join("\n"), mouvement: mouvement.join(" ").trim() };
  });
}
