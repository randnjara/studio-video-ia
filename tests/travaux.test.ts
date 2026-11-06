// Suivi des travaux serveur : lecture des nouvelles RunPod et des progressions des workers, erreurs lisibles, frise des
// étapes (durées, silence du serveur), sorte de travail et projet. Lancer : npm run test:lipsync
import { erreurLisible, frise, lireEtatRunPod, lireProgression, projetDuTravail, typeDuTravail } from "../src/lib/travaux-etapes.ts";

const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};
// Nouvelles RunPod
vrai(lireEtatRunPod({ status: "IN_QUEUE" }).etape === "file", "file d'attente");
const enCours = lireEtatRunPod({ status: "IN_PROGRESS", output: { etape: "calcul", pct: 45.04, message: "Whisper : 45 % de l'audio" } });
vrai(enCours.etape === "calcul" && enCours.progression === 45 && enCours.message.includes("45 %"), "progression Whisper");
vrai(lireEtatRunPod({ status: "IN_PROGRESS", output: { etape: "telechargement", message: "Wan 2.1" } }).etape === "telechargement", "téléchargement du modèle");
vrai(lireEtatRunPod({ status: "IN_PROGRESS" }).etape === "calcul", "en cours sans nouvelle");
const fini = lireEtatRunPod({ status: "COMPLETED", output: { video_path: "x" }, executionTime: 61234 });
vrai(fini.etape === "termine" && fini.secondes === 61.23, "terminé avec le temps de calcul");
const rate = lireEtatRunPod({ status: "COMPLETED", output: { error: "OutOfMemoryError : CUDA out of memory. Tried to allocate 2.00 GiB" } });
vrai(rate.etape === "echoue" && rate.erreur!.startsWith("La mémoire de la carte graphique") && rate.erreurDetail!.includes("2.00 GiB"), "erreur lisible + détail");
vrai(lireEtatRunPod({ status: "TIMED_OUT" }).erreur === "Le calcul a dépassé le temps permis par RunPod.", "délai dépassé");
vrai(lireEtatRunPod({ status: "CANCELLED" }).etape === "annule", "annulé");
// Progressions écrites autrement par un worker
vrai(JSON.stringify(lireProgression("calcul|60|image 60/125")) === JSON.stringify({ etape: "calcul", message: "image 60/125", progression: 60 }), "format texte");
vrai(lireProgression("plan 12/48")?.message === "plan 12/48", "texte libre");
vrai(erreurLisible("ModuleNotFoundError: No module named 'flash_attn'").includes("image du serveur"), "module manquant");
// Carte Blackwell sur une ancienne image (panne du serveur voix en prod)
vrai(erreurLisible("RuntimeError: CUDA error: no kernel image is available for execution on the device").includes("n'est pas gérée par l'image"), "no kernel image");
vrai(erreurLisible("Carte NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb (sm_120) non compatible avec l'image : torch 2.6.0+cu124 (CUDA 12.4) gère sm_50…sm_90.").startsWith("Carte NVIDIA RTX PRO 6000"), "message du worker gardé");
vrai(erreurLisible("worker is unhealthy").includes("mauvaise santé"), "worker unhealthy");

// Frise : envoyé 10:00:00 → file 10:00:02 → démarrage 10:00:40 → calcul 10:01:30 (30 %, puis 80 %) → envoi → terminé
const t0 = Date.parse("2026-11-06T10:00:00Z");
const a = (s: number) => new Date(t0 + s * 1000).toISOString();
const evts = [
  { created_at: a(0), etape: "envoye", message: "Vidéo lip-sync", progression: null },
  { created_at: a(2), etape: "file", message: "", progression: null },
  { created_at: a(40), etape: "demarrage", message: "chargement", progression: null },
  { created_at: a(90), etape: "calcul", message: "images ~38/125", progression: 30 },
  { created_at: a(130), etape: "calcul", message: "images ~100/125", progression: 80 },
  { created_at: a(170), etape: "envoi", message: "dépôt", progression: null },
  { created_at: a(175), etape: "termine", message: "", progression: 100 },
];
const f = frise(evts, "termine", t0 + 400_000);
vrai(f.fini && f.etapes.map((e) => e.etape).join() === "envoye,file,demarrage,calcul,envoi,termine", "étapes dans l'ordre, calcul regroupé");
vrai(f.etapes[3].duree === 80 && f.etapes[3].progression === 80 && f.etapes[3].message === "images ~100/125", "durée et dernier % du calcul");
vrai(f.etapes[1].duree === 38 && f.total === 175 && f.silenceMinutes === 0, "durées et total");
// En cours, serveur muet depuis 5 min : silence signalé
const muet = frise(evts.slice(0, 4), "calcul", t0 + 90_000 + 5 * 60_000 + 3000);
vrai(!muet.fini && muet.etapes.at(-1)!.etat === "en_cours" && muet.silenceMinutes === 5, "pas de nouvelle depuis 5 min");
// Échec
const ko = frise([...evts.slice(0, 3), { created_at: a(60), etape: "echoue", message: "", progression: null }], "echoue", t0 + 1e6);
vrai(ko.etapes.at(-1)!.etat === "echoue", "échec marqué ✗");

// Sorte et projet du travail, d'après la demande
const P = "98d0204c-e9dd-47af-ba96-0b5dd4a4ecce";
vrai(typeDuTravail("voix", { moteur: "aligner" }) === "calage" && typeDuTravail("voix", { moteur: "mms" }) === "voix", "types voix");
vrai(typeDuTravail("lipsync", { mode: "lipsync" }) === "lipsync" && typeDuTravail("qualite", {}) === "video-qualite" && typeDuTravail("photo", { mode: "image" }) === "photo", "types vidéo/photo");
vrai(projetDuTravail({ video_path: `${P}/essais/x.mp4` }) === P && projetDuTravail({ morceaux: [{ audio_path: `${P}/voix-off/a/b.wav` }] }) === P, "projet depuis les chemins");
vrai(projetDuTravail({ projet_id: P }) === P && projetDuTravail({ audio_path: "voix/x.wav" }) === null, "projet explicite / absent");
console.log("travaux serveur : nouvelles, erreurs lisibles, frise et silence · OK");
