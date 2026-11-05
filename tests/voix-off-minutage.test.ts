// Découpe de la voix off côté studio : sans minutage du tableau, plans bout à bout depuis 0 (aucune mise à l'échelle), et
// une voix off qui ne couvre que le début du film n'envoie que ses plans. Cas réel : projet Maman, voix « Plan 1 » de
// 17,1 s, 76 plans de 4+5+5+4+5… s (357 s). Lancer : npm run test:lipsync
import { dansLaVoix, minuter } from "../src/lib/minutage.ts";

const durees = [4, 5, 5, 4, 5, 4, 5, 5];
const plans = Array.from({ length: 76 }, (_, i) => ({ id: `p${i + 1}`, duree: durees[i % 8], debut: null, fin: null }));
const minutes = minuter(plans);
const egal = (a: unknown, b: unknown, quoi: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${quoi} : ${JSON.stringify(a)} au lieu de ${JSON.stringify(b)}`);
};
egal(minutes.slice(0, 5).map((p) => [p.debut, p.fin]), [[0, 4], [4, 9], [9, 14], [14, 18], [18, 23]], "bout à bout depuis 0");

// Sans recaler : seuls les plans qui commencent dans la voix partent ; le plan 4 (14–18 s) sera coupé à 17,1 s par le serveur
const sans = dansLaVoix(minutes, 17.1);
egal(sans.couverts.map((p) => p.id), ["p1", "p2", "p3", "p4"], "plans couverts");
egal(sans.sansVoix, 72, "plans sans voix");
egal(sans.finPrevue, 18, "fin prévue des plans couverts");
egal(sans.couverts[0].fin - sans.couverts[0].debut, 4, "le plan 1 reçoit 0–4 s");

// Avec recaler : quelques plans de plus (compression ≤ 20 %), le serveur ignore ceux qui restent hors de la voix
const avec = dansLaVoix(minutes, 17.1, 1.2);
egal(avec.couverts.map((p) => p.id), ["p1", "p2", "p3", "p4", "p5"], "plans envoyés avec recaler");
egal(avec.finPrevue, 18, "fin prévue inchangée");

// Durée de la voix inconnue : tout part, le serveur voix fait le tri
egal(dansLaVoix(minutes, null).couverts.length, 76, "durée inconnue");
console.log("voix off 17,1 s sur 76 plans : 4 plans découpés (0–4, 4–9, 9–14, 14–17,1), 72 plans sans voix · OK");
