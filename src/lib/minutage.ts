// Minutage du tableau (colonnes « debut » et « fin ») : « 00:05 », « 1:02.5 », « 00:00:05,200 », « 5 », « 5,5 s ».
// Sert au navigateur (import du tableau) comme au serveur. Renvoie des secondes, ou null si la cellule est vide ou illisible.
export function lireTemps(valeur: string | null | undefined): number | null {
  const v = String(valeur ?? "")
    .trim()
    .replace(/\s*(s|sec|secondes?)$/i, "")
    .replace(",", ".");
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  const morceaux = v.split(":");
  if (morceaux.length < 2 || morceaux.length > 3 || !morceaux.every((m) => /^\d+(\.\d+)?$/.test(m))) return null;
  return morceaux.reduce((total, m) => total * 60 + Number(m), 0);
}

// Un morceau de voix off utilisable : début ≥ 0 et fin après le début
export const segmentValide = (debut: number | null, fin: number | null): debut is number =>
  debut !== null && fin !== null && debut >= 0 && fin > debut;

// Minutage de chaque plan : celui du tableau quand il existe, sinon les durées des plans mises bout à bout
export function minuter<T extends { duree: number; debut: number | null; fin: number | null }>(plans: T[]) {
  let curseur = 0;
  return plans.map((p) => {
    const debut = p.debut ?? curseur;
    const fin = p.fin !== null && p.fin > debut ? p.fin : debut + (p.duree || 5);
    curseur = fin;
    return { ...p, debut: Math.round(debut * 1000) / 1000, fin: Math.round(fin * 1000) / 1000 };
  });
}

// Plans couverts par une voix off de « dureeVoix » secondes, minutés bout à bout depuis 0 (aucune mise à l'échelle).
// Un plan qui commence après la fin de la voix (à 0,1 s près) n'a pas de morceau : il est compté dans « sansVoix » au lieu
// de faire échouer la découpe. « marge » laisse passer quelques plans de plus quand le recalage peut comprimer le minutage
// (le serveur voix ignore ensuite ceux qui restent hors de la voix). « finPrevue » : fin prévue du dernier plan couvert,
// pour comparer à la durée réelle de la voix. Le dernier plan à moitié couvert est coupé à la fin de la voix par le serveur.
export const MORCEAU_MIN_S = 0.1;
export function dansLaVoix<T extends { debut: number; fin: number }>(plans: T[], dureeVoix: number | null, marge = 1) {
  if (!dureeVoix || dureeVoix <= 0) return { couverts: plans, sansVoix: 0, finPrevue: plans.at(-1)?.fin ?? 0 };
  const limite = dureeVoix * marge - MORCEAU_MIN_S;
  const couverts = plans.filter((p) => p.debut < limite);
  const derniers = plans.filter((p) => p.debut < dureeVoix - MORCEAU_MIN_S);
  return { couverts, sansVoix: plans.length - couverts.length, finPrevue: (derniers.at(-1) ?? couverts.at(-1))?.fin ?? 0 };
}
