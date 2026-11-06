// Import d'une voix off audio déjà finie (ElevenLabs, micro…), pour le lip-sync et le montage.
// Calculs sans réseau, utilisés par le navigateur et par les tests : format du fichier, WAV réduit quand le fichier dépasse
// la limite du stockage, et avertissements sur la durée comparée à celle des plans.

// Morceau le plus court gardé à la découpe (même valeur que MORCEAU_MIN_S de minutage.ts ; ce fichier n'importe rien pour
// rester testable seul)
const MORCEAU_MIN_S = 0.1;

// Limite d'un fichier dans le stockage « medias » (50 Mo)
export const TAILLE_MAX = 50 * 1024 * 1024;

// Formats acceptés, et le type envoyé au stockage (il n'accepte que ces types-là)
const FORMATS: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wave: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};
export const ACCEPTE = ".mp3,.wav,.m4a,.aac,.ogg,.opus,.webm,audio/*";

export const extension = (nom: string) => (nom.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

// Type à donner au stockage, ou null si ce n'est pas un fichier son accepté
export function typeAudio(nom: string, type = ""): string | null {
  const ext = extension(nom);
  if (FORMATS[ext]) return FORMATS[ext];
  if (/^audio\/(mpeg|mp3)$/.test(type)) return "audio/mpeg";
  if (/^audio\/(wav|x-wav|wave|vnd\.wave)$/.test(type)) return "audio/wav";
  if (/^audio\/(mp4|x-m4a|m4a)$/.test(type)) return "audio/mp4";
  if (type === "audio/ogg" || type === "audio/aac" || type === "audio/webm") return type;
  return null;
}

// Nom de la voix : celui du fichier, sans l'extension
export const nomDuFichier = (nom: string) => nom.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Voix off importée";

// Texte de la voix off : les répliques des plans, dans l'ordre
export const texteVoixOff = (textes: (string | null | undefined)[]) =>
  textes
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 20000);

// Fréquence du WAV mono 16 bits qui tient sous « maxOctets » (la voix garde au plus sa fréquence d'origine, 16 kHz au
// moins : c'est ce que demande le lip-sync)
export function frequencePourTaille(duree: number, frequence: number, maxOctets = TAILLE_MAX * 0.95) {
  const possible = Math.floor((maxOctets - 44) / (2 * Math.max(duree, 0.001)));
  const choix = [48000, 44100, 32000, 24000, 22050, 16000].filter((f) => f <= frequence && f <= possible);
  return choix[0] ?? (possible >= 16000 ? Math.min(frequence, possible) : null);
}

// WAV mono 16 bits (les canaux sont mélangés)
export function encoderWav(canaux: Float32Array[], frequence: number): ArrayBuffer {
  const n = canaux[0]?.length ?? 0;
  const tampon = new ArrayBuffer(44 + n * 2);
  const v = new DataView(tampon);
  const texte = (pos: number, s: string) => [...s].forEach((c, i) => v.setUint8(pos + i, c.charCodeAt(0)));
  texte(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  texte(8, "WAVE");
  texte(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, frequence, true);
  v.setUint32(28, frequence * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  texte(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    let x = 0;
    for (const c of canaux) x += c[i];
    x = Math.max(-1, Math.min(1, x / canaux.length));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return tampon;
}

// Avertissements quand la voix ne colle pas à la durée des plans (« plans » : minutage bout à bout, en secondes)
export function avertissementsDuree(dureeAudio: number | null, plans: { debut: number; fin: number }[]) {
  const total = plans.at(-1)?.fin ?? 0;
  if (!dureeAudio || dureeAudio <= 0 || total <= 0) return [];
  const ecart = (dureeAudio - total) / total;
  if (Math.abs(ecart) <= 0.1) return [];
  const pct = Math.round(Math.abs(ecart) * 100);
  const messages = [
    `La voix off (${dureeAudio.toFixed(1)} s) est ${ecart < 0 ? "plus courte" : "plus longue"} de ${pct} % que les plans (${total.toFixed(1)} s).` +
      (Math.abs(ecart) <= 0.2
        ? " Cochez « Recaler » pour caler les coupures sur les silences de la voix."
        : " « Recaler » ne l'étirera pas (plus de 20 % d'écart) : vérifiez que c'est la bonne voix, ou importez le minutage « debut » / « fin » dans le tableau."),
  ];
  if (ecart < 0) {
    const sansVoix = plans.filter((p) => p.debut >= dureeAudio - MORCEAU_MIN_S).length;
    if (sansVoix > 0)
      messages.push(
        `${sansVoix} plan${sansVoix > 1 ? "s" : ""} après ${dureeAudio.toFixed(1)} s n'${sansVoix > 1 ? "auront" : "aura"} pas de voix (pas de lip-sync).`,
      );
  }
  return messages;
}
