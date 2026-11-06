// Plans calés sur la voix off AUDIO : la seule source de minutage. Le texte de la voix off n'est que ce qui a été lu ; les
// durées, « debut » et « fin » du tableau de l'assistant ne sont que des estimations, remplacées dès qu'une voix off audio
// est choisie. Calculs sans réseau ni import (testables seuls) : application du résultat de Whisper aux plans, scission
// des répliques de plus de 5 s, repères « Xs-Ys » des prompt_video remis à l'échelle, plans dont le prompt est à refaire.

export const DUREE_MAX = 5;
// Écart de durée au-delà duquel le prompt_video, écrit pour l'ancienne durée, est à refaire
export const ECART_A_REFAIRE = 0.5;
// Plus court plan gardé (un plan muet voulu dans un silence très court garde au moins cette durée)
export const DUREE_MIN = 0.3;

// Résultat du serveur voix pour un plan (voir worker-voix/alignement.py et handler.py)
export type Cale = {
  scene_id: string;
  debut: number;
  fin: number;
  duree: number;
  trouves: number;
  total: number;
  manquants: string[];
  statut: "ok" | "approx" | "non_trouve" | "sans_parole" | "hors_voix";
  prononce?: string;
  parole_debut?: number | null;
  parole_fin?: number | null;
  pause_apres?: number | null;
  ton?: string | null;
  description?: string;
  scission?: { coupes: number[]; textes: string[] }[];
};

export type PlanTableau = {
  id: string;
  position: number;
  voiceover_text: string;
  motion_prompt: string;
  duration_s: number | string;
  pose_debut?: string | null;
  pose_fin?: string | null;
  [champ: string]: unknown;
};

const arrondi = (x: number, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const nombre = (s: string) => Number(s.replace(",", "."));
const ecrire = (x: number) => String(arrondi(x, 1)).replace(/\.0$/, "");

// Repères « 0-1s: … 1-3s: … » d'un prompt_video remis à l'échelle de la nouvelle durée, sans toucher au texte
export function echelonnerTranches(prompt: string, ancienne: number, nouvelle: number) {
  if (!(ancienne > 0) || !(nouvelle > 0) || Math.abs(ancienne - nouvelle) < 0.05) return prompt;
  const k = nouvelle / ancienne;
  return prompt.replace(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*s(\s*:)/g, (_, a: string, b: string, fin: string) => {
    return `${ecrire(nombre(a) * k)}-${ecrire(nombre(b) * k)}s${fin}`;
  });
}

// Partage un prompt_video découpé en tranches entre deux morceaux (coupure à « coupe » secondes, dans l'ancienne échelle
// « duree »). Chaque morceau garde le texte d'avant la première tranche et ses tranches, remises à partir de 0.
// Sans tranches, chaque morceau garde le prompt entier.
export function partagerPrompt(prompt: string, coupes: number[], duree: number): string[] {
  const motif = /(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*s\s*:/g;
  const tranches = [...prompt.matchAll(motif)].map((m, i, tout) => ({
    debut: nombre(m[1]),
    fin: nombre(m[2]),
    texte: prompt.slice(m.index! + m[0].length, tout[i + 1]?.index ?? prompt.length).trim(),
  }));
  const bornes = [0, ...coupes, duree];
  if (tranches.length === 0) return bornes.slice(1).map(() => prompt);
  const entete = prompt.slice(0, prompt.search(motif)).trim();
  return bornes.slice(1).map((fin, i) => {
    const debut = bornes[i];
    const morceaux = tranches
      .filter((t) => t.fin > debut + 0.05 && t.debut < fin - 0.05)
      .map((t) => `${ecrire(Math.max(t.debut, debut) - debut)}-${ecrire(Math.min(t.fin, fin) - debut)}s: ${t.texte}`);
    return [entete, ...(morceaux.length ? morceaux : [`0-${ecrire(fin - debut)}s: ${tranches.at(-1)!.texte}`])].filter(Boolean).join(" ");
  });
}

export type PlanCale = {
  id: string; // plan existant, ou nouveau plan né d'une scission
  origine: string; // plan d'origine
  nouveau: boolean;
  voiceover_text: string;
  motion_prompt: string;
  duration_s: number;
  pose_debut: string | null;
  pose_fin: string | null;
  debut: number;
  fin: number;
  prononce: string;
  ton: string | null;
  description: string;
  pause_apres: number | null;
  statut: Cale["statut"];
  manquants: string[];
  ancienneDuree: number;
  aRefaire: boolean;
};

export type ResumeCalage = {
  plans: number;
  duree: number; // durée totale = durée de la voix off
  estimee: number; // durée totale estimée par le tableau
  scindes: number;
  nonTrouves: number;
  sansParole: number;
  aRefaire: number;
  manquants: number;
};

// Applique le calage aux plans (dans l'ordre) : durées réelles, scission des répliques de plus de 5 s à la pause la plus
// proche (texte et prompt répartis, poses raccordées), repères des prompt_video remis à l'échelle. « nouvelId » fabrique
// l'identifiant d'un plan né d'une scission.
export function appliquerCalage(plans: PlanTableau[], cales: Cale[], nouvelId: () => string): { plans: PlanCale[]; resume: ResumeCalage } {
  const parPlan = new Map(cales.map((c) => [c.scene_id, c]));
  const sortie: PlanCale[] = [];
  let scindes = 0;
  for (const p of plans) {
    const c = parPlan.get(p.id);
    const ancienne = Number(p.duration_s) || 5;
    if (!c) continue;
    const base = {
      origine: p.id,
      prononce: c.prononce ?? "",
      ton: c.ton ?? null,
      description: c.description ?? "",
      statut: c.statut,
      manquants: c.manquants ?? [],
      ancienneDuree: ancienne,
    };
    const scission = c.scission?.[0];
    const coupes = (scission?.coupes ?? []).filter((t) => t > c.debut + DUREE_MIN && t < c.fin - DUREE_MIN);
    if (c.duree > DUREE_MAX && scission && coupes.length === scission.textes.length - 1) {
      scindes++;
      const bornes = [c.debut, ...coupes, c.fin];
      // Les tranches du prompt sont partagées à la même place relative dans l'ancienne durée
      const relatives = coupes.map((t) => ((t - c.debut) / (c.fin - c.debut)) * ancienne);
      const prompts = partagerPrompt(p.motion_prompt ?? "", relatives, ancienne);
      const mots = (c.prononce ?? "").split(/\s+/).filter(Boolean);
      bornes.slice(1).forEach((fin, k) => {
        const debut = bornes[k];
        const duree = arrondi(fin - debut);
        const relBornes = [0, ...relatives, ancienne];
        const partAncienne = relBornes[k + 1] - relBornes[k] || ancienne;
        sortie.push({
          ...base,
          id: k === 0 ? p.id : nouvelId(),
          nouveau: k > 0,
          voiceover_text: scission.textes[k],
          motion_prompt: echelonnerTranches(prompts[k], partAncienne, duree),
          duration_s: duree,
          // Poses raccordées : le premier morceau finit sur la pose de fin, tenue par les morceaux suivants
          pose_debut: k === 0 ? (p.pose_debut ?? null) : (p.pose_fin ?? null),
          pose_fin: p.pose_fin ?? null,
          debut: arrondi(debut, 3),
          fin: arrondi(fin, 3),
          prononce: mots.length ? scission.textes[k] : "",
          pause_apres: k === bornes.length - 2 ? (c.pause_apres ?? null) : null,
          aRefaire: true,
        });
      });
      continue;
    }
    const duree = Math.max(DUREE_MIN, arrondi(c.fin - c.debut));
    sortie.push({
      ...base,
      id: p.id,
      nouveau: false,
      voiceover_text: p.voiceover_text,
      motion_prompt: echelonnerTranches(p.motion_prompt ?? "", ancienne, duree),
      duration_s: duree,
      pose_debut: p.pose_debut ?? null,
      pose_fin: p.pose_fin ?? null,
      debut: arrondi(c.debut, 3),
      fin: arrondi(c.fin, 3),
      pause_apres: c.pause_apres ?? null,
      aRefaire: Math.abs(duree - ancienne) > ECART_A_REFAIRE,
    });
  }
  const resume: ResumeCalage = {
    plans: sortie.length,
    duree: arrondi(cales.reduce((m, c) => Math.max(m, c.fin), 0), 2),
    estimee: arrondi(plans.reduce((n, p) => n + (Number(p.duration_s) || 5), 0), 2),
    scindes,
    nonTrouves: sortie.filter((p) => p.statut === "non_trouve" || p.statut === "hors_voix").length,
    sansParole: sortie.filter((p) => p.statut === "sans_parole").length,
    aRefaire: sortie.filter((p) => p.aRefaire).length,
    manquants: sortie.reduce((n, p) => n + p.manquants.length, 0),
  };
  return { plans: sortie, resume };
}

// Version du tableau gardée avant le calage (project_versions, data.tableau) : un plan dont la durée a changé de plus de
// 0,5 s et dont le prompt_video n'a pas été réécrit depuis (sauf la remise à l'échelle des repères) a son prompt à refaire
export type PlanAvant = { id: string; duration_s: number | string; motion_prompt: string };
export function promptARefaire(p: { id: string; duration_s: number | string; motion_prompt: string }, avant: Map<string, PlanAvant>, scindes: Set<string>) {
  if (scindes.has(p.id)) return true;
  const a = avant.get(p.id);
  if (!a) return false;
  const ancienne = Number(a.duration_s) || 5;
  const duree = Number(p.duration_s) || 5;
  if (Math.abs(duree - ancienne) <= ECART_A_REFAIRE) return false;
  // Réécrit depuis (tableau réimporté) : plus à refaire
  return echelonnerTranches(a.motion_prompt ?? "", ancienne, duree) === p.motion_prompt;
}
