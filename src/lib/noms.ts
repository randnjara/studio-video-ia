// Clé de comparaison des noms de lieux et de personnages : « JARDIN CELESTE », « Jardin céleste » et
// « jardin  céleste » désignent le même lieu (sans tenir compte des majuscules, des accents ni des espaces).
export const cleNom = (t: string | null | undefined) =>
  (t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const memeNom = (a: string | null | undefined, b: string | null | undefined) => cleNom(a) === cleNom(b);
