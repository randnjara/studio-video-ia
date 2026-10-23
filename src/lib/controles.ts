// Alertes calculées sur le tableau des plans, pour ne pas refaire les erreurs vues avec ChatGPT
// (gestes copiés en boucle, cadrages identiques, voix off trop longue, consignes vidéo pas en anglais).
// Aucun appel extérieur : tout se calcule à l'affichage.

export type PlanControle = {
  id: string;
  motion_prompt: string;
  image_description: string;
  voiceover_text: string;
  duration_s: number;
  cadrage: string;
  angle: string;
};

// Débit moyen d'une voix posée, en mots par seconde
export const MOTS_PAR_SECONDE = 2.5;
const VOISINS = 10; // ChatGPT répétait les gestes par cycles de 10 scènes

const mots = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 2);

// Part de mots en commun entre deux textes (0 à 1)
export function ressemblance(a: string, b: string) {
  const A = new Set(mots(a));
  const B = new Set(mots(b));
  if (A.size < 3 || B.size < 3) return 0;
  let communs = 0;
  for (const m of A) if (B.has(m)) communs++;
  return communs / (A.size + B.size - communs);
}

export function dureeVoix(texte: string) {
  const n = texte.trim().split(/\s+/).filter(Boolean).length;
  return n / MOTS_PAR_SECONDE;
}

const ANGLAIS = new Set("the a an and with of to in on at her his she he their slowly slow camera looks look smiles smile turns turn hand hands head while toward towards into from gently soft light".split(" "));
const AUTRES = new Set("le la les une des et avec sur dans vers elle il son sa ses lentement doucement main mains tete regarde sourit ny sy amin ary izy mitsiky mijery manokatra tanana loha".split(" "));

// Les modèles vidéo comprennent surtout l'anglais : on repère une consigne écrite en français ou en malgache
export function pasEnAnglais(texte: string) {
  const liste = texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z']+/)
    .filter(Boolean);
  if (liste.length < 4) return false;
  const en = liste.filter((m) => ANGLAIS.has(m)).length;
  const autre = liste.filter((m) => AUTRES.has(m)).length;
  return autre > en;
}

// Le mouvement mis par défaut à l'import n'est pas une répétition choisie : il est signalé à part
export function alertesPlans(plans: PlanControle[], mouvementParDefaut = "") {
  const alertes = new Map<string, string[]>();
  const ajouter = (id: string, texte: string) => alertes.set(id, [...(alertes.get(id) ?? []), texte]);

  plans.forEach((p, i) => {
    // Répétitions avec les plans précédents proches (chaque paire n'est signalée qu'une fois, sur le second plan)
    for (let j = Math.max(0, i - VOISINS); j < i; j++) {
      const q = plans[j];
      if (p.motion_prompt !== mouvementParDefaut && ressemblance(p.motion_prompt, q.motion_prompt) >= 0.8)
        ajouter(p.id, `Même mouvement que le plan ${j + 1} : variez le geste ou la caméra.`);
      if (ressemblance(p.image_description, q.image_description) >= 0.8)
        ajouter(p.id, `Photo presque identique à celle du plan ${j + 1} : changez le cadrage, l'angle ou l'action.`);
    }
    const prec = plans[i - 1];
    if (prec && p.cadrage && p.angle && p.cadrage === prec.cadrage && p.angle === prec.angle)
      ajouter(p.id, `Même cadrage et même angle que le plan ${i} : les deux plans vont sembler collés.`);

    const voix = dureeVoix(p.voiceover_text);
    const duree = Number(p.duration_s || 5);
    if (voix > duree + 0.5)
      ajouter(p.id, `Voix off d'environ ${Math.ceil(voix)} s pour un plan de ${duree} s : raccourcissez le texte ou coupez en deux plans.`);

    if (mouvementParDefaut && p.motion_prompt === mouvementParDefaut)
      ajouter(p.id, "Mouvement passe-partout : écrivez le geste propre à cette réplique.");
    if (pasEnAnglais(p.motion_prompt))
      ajouter(p.id, "Mouvement écrit en français ou en malgache : le modèle vidéo comprend surtout l'anglais.");
  });
  return alertes;
}
