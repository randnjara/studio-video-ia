// Import d'une voix off audio finie (onglet Plans) : formats acceptés, nom, texte, WAV réduit sous 50 Mo, avertissements
// de durée. Cas réel : projet 9974481b… (75 plans, 5 min 53 s). Lancer : npm run test:lipsync
import {
  TAILLE_MAX,
  avertissementsDuree,
  encoderWav,
  frequencePourTaille,
  nomDuFichier,
  texteVoixOff,
  typeAudio,
} from "../src/lib/voix-off-import.ts";

const egal = (a: unknown, b: unknown, quoi: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${quoi} : ${JSON.stringify(a)} au lieu de ${JSON.stringify(b)}`);
};
const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};

// Formats : MP3, WAV, M4A, OGG acceptés avec le type que le stockage autorise ; le reste refusé
egal(typeAudio("Voix off ElevenLabs.mp3"), "audio/mpeg", "mp3");
egal(typeAudio("voix.WAV"), "audio/wav", "wav");
egal(typeAudio("micro.m4a", "audio/x-m4a"), "audio/mp4", "m4a");
egal(typeAudio("voix.ogg"), "audio/ogg", "ogg");
egal(typeAudio("sans-extension", "audio/x-wav"), "audio/wav", "type seul");
egal(typeAudio("script.pdf", "application/pdf"), null, "pdf refusé");
egal(nomDuFichier("Voix off ElevenLabs v3.mp3"), "Voix off ElevenLabs v3", "nom");
egal(texteVoixOff([" Tonga soa ", "", null, "Misaotra"]), "Tonga soa\nMisaotra", "texte des plans");

// 75 plans de 5 min 53 s (353 s) bout à bout
const durees = Array.from({ length: 75 }, (_, i) => (i === 74 ? 353 - 74 * 4.7 : 4.7));
let t = 0;
const plans = durees.map((d) => ({ debut: t, fin: (t += d) }));
vrai(Math.abs(plans.at(-1)!.fin - 353) < 1e-9, "353 s");

egal(avertissementsDuree(350, plans), [], "voix à moins de 10 % : rien");
const proche = avertissementsDuree(310, plans); // 12 % plus courte
vrai(proche.length === 2 && proche[0].includes("Recaler") && proche[0].includes("plus courte"), "10–20 % : proposer Recaler");
vrai(/plans? après 310\.0 s/.test(proche[1]), "plus courte : plans sans voix annoncés");
const courte = avertissementsDuree(17.1, plans);
vrai(courte[0].includes("ne l'étirera pas") && courte[1].startsWith("71 plans après 17.1 s"), `voix de 17,1 s : ${courte.join(" | ")}`);
const longue = avertissementsDuree(400, plans);
vrai(longue.length === 1 && longue[0].includes("plus longue"), "plus longue : pas de plans sans voix");

// WAV trop gros : 6 min de WAV stéréo 48 kHz (≈ 69 Mo) → WAV mono qui tient sous 50 Mo
const f = frequencePourTaille(360, 48000)!;
vrai(f === 48000 && 44 + 360 * f * 2 < TAILLE_MAX, `fréquence ${f}`);
const f2 = frequencePourTaille(20 * 60, 44100)!;
vrai(f2 >= 16000 && 44 + 20 * 60 * f2 * 2 < TAILLE_MAX, `20 min → ${f2} Hz`);
egal(frequencePourTaille(3 * 3600, 44100), null, "3 h : trop long");
const wav = new DataView(encoderWav([new Float32Array([0, 1, -1, 0.5]), new Float32Array([0, 1, -1, -0.5])], 16000));
egal([wav.getUint32(24, true), wav.getUint16(22, true), wav.getUint32(40, true)], [16000, 1, 8], "en-tête WAV mono 16 kHz");
egal([wav.getInt16(46, true), wav.getInt16(48, true), wav.getInt16(50, true)], [32767, -32768, 0], "canaux mélangés");
console.log("import de voix off : formats, avertissements de durée et WAV < 50 Mo · OK");
