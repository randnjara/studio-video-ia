// Alerte « voix off trop longue » : jamais pour un minutage lu dans l'audio, seuil de 4 mots/s pour une durée estimée.
// Lancer : npm run test:lipsync
import { MOTS_PAR_SECONDE_MAX, minutageDeLAudio, voixTropLongue } from "../src/lib/debit-voix.ts";

const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};
const mots = (n: number) => Array.from({ length: n }, (_, i) => `teny${i}`).join(" ");
vrai(MOTS_PAR_SECONDE_MAX === 4, "seuil unique de 4 mots/s");
// Plan audio à 3,5 mots/s (14 mots en 4 s) : aucune alerte ; même à 6 mots/s, l'audio fait foi
vrai(voixTropLongue({ texte: mots(14), duree: 4, minutageAudio: true }) === null, "audio 3,5 mots/s");
vrai(voixTropLongue({ texte: mots(24), duree: 4, minutageAudio: true }) === null, "audio 6 mots/s : l'audio fait foi");
// Plan estimé à 3,5 mots/s : aucune alerte (l'ancien seuil de 2,5 l'aurait signalé)
vrai(voixTropLongue({ texte: mots(14), duree: 4 }) === null, "estimé 3,5 mots/s");
vrai(voixTropLongue({ texte: mots(20), duree: 5 }) === null, "estimé 4 mots/s pile");
// Plan estimé à 4,5 mots/s (18 mots en 4 s) : alerte
const a = voixTropLongue({ texte: mots(18), duree: 4 });
vrai(a !== null && a.debit === 4.5 && a.dureeNecessaire === 4.5, `estimé 4,5 mots/s : ${JSON.stringify(a)}`);
// D'où vient le minutage
vrai(minutageDeLAudio([{ voix_creation_id: "v1", audio_path: "", duration_s: null }]), "calé sur une voix du projet");
vrai(minutageDeLAudio([{ voix_creation_id: null, audio_path: "p/voix-off/a.wav", duration_s: 3.2 }]), "morceau découpé dans l'audio");
vrai(!minutageDeLAudio([{ voix_creation_id: null, audio_path: "", duration_s: null }]), "minutage du tableau seulement : estimé");
vrai(!minutageDeLAudio(undefined), "aucun morceau : estimé");
console.log("voix off trop longue : jamais sur l'audio, seuil de 4 mots/s sinon · OK");
