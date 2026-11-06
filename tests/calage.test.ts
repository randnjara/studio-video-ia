// Plans calés sur la voix off audio (projet 9974481b : voix ElevenLabs de 221,1 s, 75 plans estimés à 353 s).
// Lancer : npm run test:lipsync
import { appliquerCalage, echelonnerTranches, partagerPrompt, promptARefaire, type Cale, type PlanTableau } from "../src/lib/calage.ts";

const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};

// Repères « Xs-Ys » remis à l'échelle, texte intact
vrai(
  echelonnerTranches("Static camera. 0-1s: she breathes. 1-3s: she nods. 3-5s: she smiles.", 5, 2.8) ===
    "Static camera. 0-0.6s: she breathes. 0.6-1.7s: she nods. 1.7-2.8s: she smiles.",
  "mise à l'échelle 5 → 2,8 s",
);
vrai(echelonnerTranches("Slow push-in, she smiles.", 5, 3) === "Slow push-in, she smiles.", "sans repères : inchangé");
const parts = partagerPrompt("Camera still. 0-1s: A. 1-3s: B. 3-5s: C.", [3], 5);
vrai(parts[0] === "Camera still. 0-1s: A. 1-3s: B." && parts[1] === "Camera still. 0-2s: C.", `partage : ${JSON.stringify(parts)}`);

// 75 plans estimés à 353 s (4, 5, 5, 4, 5…) ; la voix réelle fait 221,1 s
const estimees = Array.from({ length: 75 }, (_, i) => [4, 5, 5, 4, 5][i % 5]);
estimees[74] += 353 - estimees.reduce((a, b) => a + b, 0);
const plans: PlanTableau[] = estimees.map((d, i) => ({
  id: `s${i + 1}`,
  position: i + 1,
  voiceover_text: `Réplique ${i + 1} misy teny vitsivitsy. Ary teny hafa koa.`,
  motion_prompt: `Static camera. 0-1s: gesture ${i}. 1-${d - 1}s: slow nod. ${d - 1}-${d}s: holds still.`,
  duration_s: d,
  pose_debut: `pose ${i}`,
  pose_fin: `pose ${i + 1}`,
}));
// Durées réelles lues dans l'audio : environ 2,95 s par plan, le plan 10 dure 6,4 s (scindé à une pause)
let t = 0;
const cales: Cale[] = plans.map((p, i) => {
  const d = i === 9 ? 6.4 : i === 74 ? 0 : 2.9;
  const c: Cale = { scene_id: p.id, debut: t, fin: t + d, duree: d, trouves: 8, total: 8, manquants: [], statut: "ok", prononce: p.voiceover_text };
  if (i === 9) c.scission = [{ coupes: [t + 3.3], textes: ["Réplique 10 misy teny vitsivitsy.", "Ary teny hafa koa."] }];
  t += d;
  return c;
});
cales[74].fin = cales[74].debut + (221.1 - cales[74].debut);
cales[74].duree = cales[74].fin - cales[74].debut;
let n = 0;
const { plans: cale, resume } = appliquerCalage(plans, cales, () => `nouveau-${++n}`);
const total = cale.reduce((s, p) => s + p.duration_s, 0);
console.log(`calage : ${resume.plans} plans, total ${total.toFixed(2)} s (estimé ${resume.estimee} s), ${resume.scindes} scindé, ${resume.nonTrouves} sans voix, ${resume.aRefaire} prompts à refaire`);
vrai(Math.abs(total - 221.1) < 0.05 && resume.duree === 221.1, "durée du film = durée de l'audio");
vrai(resume.nonTrouves === 0, "0 plan sans voix");
vrai(resume.plans === 76 && resume.scindes === 1, "la réplique de 6,4 s est scindée en deux plans");
vrai(cale.every((p) => p.duration_s <= 5), "aucun plan de plus de 5 s");
// Plan scindé : textes répartis, poses raccordées, nouveau plan à la suite
const [a, b] = [cale[9], cale[10]];
vrai(a.id === "s10" && b.id === "nouveau-1" && b.nouveau, "scission en place");
vrai(a.voiceover_text.endsWith("vitsivitsy.") && b.voiceover_text === "Ary teny hafa koa.", "texte réparti");
vrai(a.pose_fin === b.pose_debut, "pose_fin → pose_debut raccordées");
vrai(Math.abs(a.duration_s - 3.3) < 1e-9 && Math.abs(b.duration_s - 3.1) < 1e-9, "durées de la scission");
// Prompts : repères remis à l'échelle de la vraie durée, « prompt à refaire » si l'écart dépasse 0,5 s
vrai(cale[0].motion_prompt.includes("0-0.7s") && cale[0].aRefaire, `plan 1 (4 → 2,9 s) : ${cale[0].motion_prompt}`);
vrai(cale.filter((p) => p.aRefaire).length === resume.aRefaire && resume.aRefaire >= 74, "prompts à refaire");
// Après réimport d'un tableau réécrit : plus à refaire
const avant = new Map(plans.map((p) => [p.id, { id: p.id, duration_s: p.duration_s, motion_prompt: p.motion_prompt }]));
vrai(promptARefaire({ id: "s1", duration_s: cale[0].duration_s, motion_prompt: cale[0].motion_prompt }, avant, new Set()), "à refaire après calage");
vrai(!promptARefaire({ id: "s1", duration_s: cale[0].duration_s, motion_prompt: "0-1s: new. 1-2.9s: rewritten." }, avant, new Set()), "réécrit : plus à refaire");
console.log("OK");
