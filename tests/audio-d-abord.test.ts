// Flux « audio d'abord » : les répliques audio sont la liste des plans ; à l'import, numéro, début, fin, durée et voix
// sont vérifiés et remis à leur valeur audio. Lancer : npm run test:lipsync
import { plansDeLAudio, verifierLignesAudio } from "../src/lib/audio-d-abord.ts";

const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};
const repliques = [
  { debut: 0.3, fin: 2.26, texte: "Manao ahoana ianareo?" },
  { debut: 2.8, fin: 6.1, texte: "Faly be aho anio satria tonga eto daholo ianareo." },
  { debut: 6.6, fin: 9.36, texte: "Andao hiresaka momba ny reniko." },
];
vrai(JSON.stringify(plansDeLAudio(repliques)[1]) === JSON.stringify({ numero: 2, debut: 2.8, fin: 6.1, duree: 3.3, voix: "Faly be aho anio satria tonga eto daholo ianareo." }), "plans de l'audio");

// Tableau fidèle (numéros donnés, ordre mélangé) : rien à corriger, lignes remises dans l'ordre
const fidele = [3, 1, 2].map((n) => ({ numero: n, voix: repliques[n - 1].texte, debut: repliques[n - 1].debut, fin: repliques[n - 1].fin, duree: repliques[n - 1].fin - repliques[n - 1].debut, prompt_video: `p${n}` }));
const ok = verifierLignesAudio(fidele, repliques);
vrai(!("erreur" in ok) && ok.corrections.length === 0 && ok.lignes.map((l) => l.prompt_video).join() === "p1,p2,p3", "tableau fidèle");

// L'assistant a « corrigé » une réplique, arrondi les temps et ajouté une ligne : tout est remis à l'audio
const derive = [
  { numero: 1, voix: "Manahoana ianareo !", debut: 0, fin: 5, duree: 5 },
  { numero: 2, voix: repliques[1].texte, debut: 2.8, fin: 6.1, duree: 5 },
  { numero: 3, voix: repliques[2].texte, debut: 6.6, fin: 9.36, duree: 2.76 },
  { numero: 4, voix: "Ligne inventée", debut: 9.4, fin: 12, duree: 2.6 },
];
const r = verifierLignesAudio(derive, repliques);
vrai(!("erreur" in r), "corrigé, pas refusé");
if (!("erreur" in r)) {
  vrai(r.lignes.length === 3 && r.lignes[0].voix === "Manao ahoana ianareo?" && r.lignes[0].debut === 0.3 && r.lignes[0].duree === 1.96, "ligne 1 remise à l'audio");
  vrai(r.lignes[1].duree === 3.3, "durée remise");
  vrai(r.corrections.some((c) => c.includes("Ligne 4 ignorée")) && r.corrections.length === 4, r.corrections.join(" | "));
}
// Il manque une réplique : refusé
const manque = verifierLignesAudio(fidele.slice(0, 2), repliques);
vrai("erreur" in manque && manque.erreur.includes("Il manque 1 ligne"), "réplique manquante refusée");
// Sans numéros : par la place
vrai(!("erreur" in verifierLignesAudio(repliques.map((x) => ({ voix: x.texte })), repliques)), "sans numéros, par la place");
console.log("audio d'abord : import vérifié et remis au minutage audio · OK");
