// Flux « audio d'abord » (par défaut) : la voix off AUDIO est découpée par Whisper en répliques de 5 s au plus, aux
// pauses et aux fins de phrases ; ce découpage EST la liste des plans (numéro, début, fin, durée, texte prononcé). Le
// tableau de l'assistant ne remplit que la mise en scène ; à l'import, numéro, début, fin, durée et voix sont vérifiés et
// remis à leur valeur audio. Sans import : testable seul.

export type RepliqueAudio = { debut: number; fin: number; texte: string; ton?: string; description?: string };

export type LigneImportee = {
  numero?: number | null;
  voix: string;
  debut?: number | null;
  fin?: number | null;
  duree?: number | null;
  [champ: string]: unknown;
};

const arrondi = (x: number, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const normaliser = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Les plans tels que l'audio les donne : numéro, début, fin, durée, voix
export const plansDeLAudio = (repliques: RepliqueAudio[]) =>
  repliques.map((r, i) => ({ numero: i + 1, debut: arrondi(r.debut, 2), fin: arrondi(r.fin, 2), duree: arrondi(r.fin - r.debut, 2), voix: r.texte.trim() }));

// Vérifie un tableau importé contre les répliques audio : chaque ligne est retrouvée par son numéro (ou sa place), et
// numéro, début, fin, durée et voix reprennent la valeur audio. Renvoie les lignes corrigées (une par réplique, dans
// l'ordre), la liste des corrections faites, ou une erreur quand il manque des répliques.
export function verifierLignesAudio<T extends LigneImportee>(
  lignes: T[],
  repliques: RepliqueAudio[],
): { lignes: (T & { numero: number; debut: number; fin: number; duree: number })[]; corrections: string[] } | { erreur: string } {
  const attendus = plansDeLAudio(repliques);
  const corrections: string[] = [];
  const avecNumero = lignes.length > 0 && lignes.every((l) => Number.isInteger(l.numero) && Number(l.numero) > 0);
  const parNumero = new Map<number, T>();
  lignes.forEach((l, i) => {
    const n = avecNumero ? Number(l.numero) : i + 1;
    if (n > attendus.length) corrections.push(`Ligne ${n} ignorée : l'audio n'a que ${attendus.length} répliques.`);
    else if (parNumero.has(n)) corrections.push(`Ligne ${n} en double : seule la première est gardée.`);
    else parNumero.set(n, l);
  });
  const manquants = attendus.filter((a) => !parNumero.has(a.numero)).map((a) => a.numero);
  if (manquants.length)
    return {
      erreur: `Il manque ${manquants.length} ligne(s) : ${manquants.slice(0, 15).join(", ")}${manquants.length > 15 ? "…" : ""}. Le tableau doit avoir exactement ${attendus.length} lignes, une par réplique audio, avec les mêmes numéros.`,
    };
  const sortie = attendus.map((a) => {
    const l = parNumero.get(a.numero)!;
    if (normaliser(l.voix ?? "") !== normaliser(a.voix)) corrections.push(`Ligne ${a.numero} : « voix » remise au texte prononcé.`);
    const ecart = (x: number | null | undefined, y: number) => x === null || x === undefined || Math.abs(x - y) > 0.06;
    if (ecart(l.debut, a.debut) || ecart(l.fin, a.fin)) corrections.push(`Ligne ${a.numero} : début et fin remis au minutage audio.`);
    else if (ecart(l.duree, a.duree)) corrections.push(`Ligne ${a.numero} : durée remise à la durée audio.`);
    return { ...l, numero: a.numero, voix: a.voix, debut: a.debut, fin: a.fin, duree: a.duree };
  });
  return { lignes: sortie, corrections };
}
