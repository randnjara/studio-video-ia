// Prévention des risques (lip-sync) : détection des plans à risque avec score et raison, et correction automatique
// proposée de prompt_video. Lancer : npm run test:lipsync
import { corrigerPrompt, raisonsPlan, REGLES_RISQUES, risquesPlans, type PlanRisque } from "../src/lib/risques.ts";

const vrai = (x: boolean, quoi: string) => {
  if (!x) throw new Error(quoi);
};
const codes = (p: Partial<PlanRisque>, avant?: Partial<PlanRisque>, lipsync = true) =>
  raisonsPlan({ id: "x", motion_prompt: "", ...p }, avant ? { id: "a", motion_prompt: "", ...avant } : undefined, lipsync).map((r) => r.code);

// Un plan propre : aucun risque
const propre = "0-1s: camera still, she breathes calmly, eyes on the lens. 1-4s: she makes a small slow open-hand gesture at chest height, light smile. 4-5s: hands rest, head straight. Background: leaves sway gently.";
vrai(codes({ motion_prompt: propre, cadrage: "plan poitrine", pose_fin: "mains posées, regard caméra" }, { cadrage: "plan taille" }).length === 0, "plan propre sans risque");

// 1. Recul et cadrage plus large, corps qui entre dans le cadre
vrai(codes({ motion_prompt: "1-4s: the camera slowly pulls back to reveal her full body" }).includes("recul"), "pull back");
vrai(codes({ motion_prompt: propre, cadrage: "plan taille" }, { cadrage: "plan poitrine" }).includes("recul"), "cadrage plus large");
vrai(codes({ motion_prompt: "her hands rise into the frame" }).includes("corps-entrant"), "mains qui entrent");
// 2. Rire, tête inclinée
vrai(codes({ motion_prompt: "she laughs and tilts her head" }).join() === "rire,tete", "rire + tête");
vrai(codes({ pose_fin: "tête penchée, éclate de rire" }).join() === "rire,tete", "rire + tête en français");
// 3. Émotion par la bouche
vrai(codes({ motion_prompt: "she presses her lips, tears roll down" }).includes("bouche-emotion"), "lèvres pressées");
vrai(codes({ intention: "émue, menton qui tremble" }).includes("bouche-emotion"), "menton qui tremble");
// 4. Mains et doigts
vrai(codes({ motion_prompt: "she raises her hand to her mouth" }).includes("mains-visage"), "main à la bouche");
vrai(codes({ motion_prompt: "she counts on her fingers, then raises her index finger" }).includes("doigts"), "doigts");
vrai(codes({ pose_debut: "main droite sur la joue" }).includes("mains-visage"), "main sur la joue (pose)");
// 5. Objets, cheveux, lumière ; 6. arcs
vrai(codes({ motion_prompt: "she picks up a cup" }).includes("objet"), "objet tenu");
vrai(codes({ motion_prompt: "the wind blows her hair across her face" }).includes("cheveux"), "cheveux");
vrai(codes({ motion_prompt: "the camera orbits around her" }).includes("arc"), "orbite");
vrai(codes({ motion_prompt: "a slow 30° arc around her" }).includes("arc"), "arc de 30°");
vrai(!codes({ motion_prompt: "a slow 10° arc to the left" }).includes("arc"), "arc de 10° permis");
// 7. Parole en lip-sync seulement
vrai(codes({ motion_prompt: "she speaks softly to the camera" }).includes("parole"), "parole en lip-sync");
vrai(!codes({ motion_prompt: "she speaks softly to the camera" }, undefined, false).includes("parole"), "parole permise sans lip-sync");

// Correction proposée : plus aucun risque après correction
const risque = "0-1s: she laughs and tilts her head. 1-3s: the camera slowly pulls back while she speaks, she raises her hand to her mouth. 3-5s: she counts on her fingers, lips trembling, the camera orbits around her.";
const corrige = corrigerPrompt(risque, true)!;
vrai(corrige !== null, "une correction est proposée");
const restants = codes({ motion_prompt: corrige });
vrai(restants.length === 0, `corrigé sans risque : ${restants.join(", ")} ← ${corrige}`);
vrai(corrigerPrompt(propre, true) === null, "rien à corriger sur un plan propre");

// Score et ordre : le plan le plus risqué d'abord, avec sa raison
const liste = risquesPlans(
  [
    { id: "p1", motion_prompt: propre, cadrage: "plan poitrine" },
    { id: "p2", motion_prompt: "she laughs while she speaks", cadrage: "plan poitrine" },
    { id: "p3", motion_prompt: risque, cadrage: "plan taille" },
  ],
  true,
);
vrai(liste.length === 2 && liste[0].id === "p3" && liste[0].niveau === "élevé" && liste[0].numero === 3, "p3 en tête, élevé");
vrai(liste[1].id === "p2" && liste[1].score === 5 && liste[1].raisons.some((r) => r.texte.startsWith("R7")), "p2 : rire + parole");
vrai(REGLES_RISQUES.includes("R7") && REGLES_RISQUES.includes("15°"), "règles complètes");
console.log(`risques : 7 règles détectées, corrections sans risque restant (p3 score ${liste[0].score}) · OK`);
