// Garde-fou « voix off trop longue pour la durée du plan » (sans import : testable seul).
// - Plan dont le minutage vient de l'audio réel (tableau préparé depuis l'audio, plan « 🎧 calé sur l'audio », morceau de
//   voix off découpé dans l'audio) : sa durée EST celle de la réplique prononcée, il n'y a jamais d'alerte.
// - Plan à durée estimée depuis le texte : alerte seulement au-delà de MOTS_PAR_SECONDE_MAX (Mama parle à environ 3 mots
//   par seconde : seul un vrai décalage dépasse 4).

export const MOTS_PAR_SECONDE_MAX = 4;

export const nombreDeMots = (texte: string) => String(texte ?? "").trim().split(/\s+/).filter(Boolean).length;

// Le plan a-t-il son minutage dans l'audio réel ? (morceau de voix off calé sur une voix du projet, ou découpé dans l'audio)
export function minutageDeLAudio(clips: { voix_creation_id?: string | null; audio_path?: string | null; duration_s?: number | string | null }[] | null | undefined) {
  return (clips ?? []).some((v) => Boolean(v.voix_creation_id) || (Boolean(v.audio_path) && v.duration_s !== null && v.duration_s !== undefined));
}

// null : rien à signaler ; sinon le débit et la durée qu'il faudrait pour rester sous le seuil
export function voixTropLongue(p: { texte: string; duree: number; minutageAudio?: boolean }) {
  if (p.minutageAudio) return null;
  const mots = nombreDeMots(p.texte);
  const duree = Number(p.duree) || 5;
  const debit = mots / duree;
  if (debit <= MOTS_PAR_SECONDE_MAX) return null;
  return { mots, debit: Math.round(debit * 10) / 10, dureeNecessaire: Math.ceil((mots / MOTS_PAR_SECONDE_MAX) * 10) / 10 };
}
