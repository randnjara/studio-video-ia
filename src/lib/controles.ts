// Alertes calculées sur le tableau des plans, pour ne pas refaire les erreurs vues avec ChatGPT
// (gestes copiés en boucle, cadrages identiques, voix off trop longue, consignes vidéo pas en anglais).
// Aucun appel extérieur : tout se calcule à l'affichage.

import { CATEGORIES, type Categorie, plansContinus } from "@/lib/categories";

export type PlanControle = {
  id: string;
  motion_prompt: string;
  image_description: string;
  voiceover_text: string;
  duration_s: number;
  cadrage: string;
  angle: string;
  pose_fin?: string;
  lieu?: string | null;
  plan_continu?: number | null;
};

// Débit moyen d'une voix posée, en mots par seconde
export const MOTS_PAR_SECONDE = 2.5;
// Le modèle vidéo (Wan 2.2) est fait pour des clips de 5 s : plus long, l'image se dégrade
export const DUREE_MAX = 5;
const VOISINS = 10; // ChatGPT répétait les gestes par cycles de 10 scènes

const mots = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 2);

// Part de mots en commun entre deux textes (0 à 1), sans compter les mots de « communs »
export function ressemblance(a: string, b: string, communs: Set<string> = new Set()) {
  let A = new Set(mots(a).filter((m) => !communs.has(m)));
  let B = new Set(mots(b).filter((m) => !communs.has(m)));
  // Presque rien de propre au plan : c'est le même texte recopié partout, on compare alors les textes entiers
  if (A.size < 3 || B.size < 3) {
    A = new Set(mots(a));
    B = new Set(mots(b));
  }
  if (A.size < 3 || B.size < 3) return 0;
  let partages = 0;
  for (const m of A) if (B.has(m)) partages++;
  return partages / (A.size + B.size - partages);
}

// Mots présents dans plus d'un tiers des textes : description du personnage et du lieu, règles recopiées dans chaque
// prompt. Ils sont voulus (continuité) et ne disent rien du geste propre au plan, on les laisse de côté pour comparer.
function motsCommuns(textes: string[]) {
  const compte = new Map<string, number>();
  for (const t of textes) for (const m of new Set(mots(t))) compte.set(m, (compte.get(m) ?? 0) + 1);
  const seuil = Math.max(3, textes.length / 3);
  return new Set([...compte].filter(([, n]) => n > seuil).map(([m]) => m));
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
// Les lignes d'un même plan continu partagent volontairement la photo, le cadrage, l'angle et la pose de base :
// ces ressemblances ne sont signalées qu'entre deux plans continus différents.
export function alertesPlans(plans: PlanControle[], mouvementParDefaut = "", categorie: Categorie = "film") {
  const alertes = new Map<string, string[]>();
  const ajouter = (id: string, texte: string) => alertes.set(id, [...(alertes.get(id) ?? []), texte]);
  const communsMvt = motsCommuns(plans.map((p) => p.motion_prompt));
  const communsPhoto = motsCommuns(plans.map((p) => p.image_description));
  const continus = plansContinus(plans);
  const cat = CATEGORIES[categorie];

  plans.forEach((p, i) => {
    // Répétitions avec les plans précédents proches : on signale le plus proche, une fois par sorte de répétition
    // (chaque paire n'est signalée que sur le second plan)
    const proche = (pareil: (q: PlanControle) => boolean, autrePlan = false) => {
      for (let j = i - 1; j >= Math.max(0, i - VOISINS); j--)
        if ((!autrePlan || continus[j].numero !== continus[i].numero) && pareil(plans[j])) return j + 1;
      return 0;
    };
    const mvt = p.motion_prompt !== mouvementParDefaut ? proche((q) => ressemblance(p.motion_prompt, q.motion_prompt, communsMvt) >= 0.8) : 0;
    if (mvt) ajouter(p.id, `Même mouvement que le plan ${mvt} : variez le geste ou la caméra.`);
    const fin = p.pose_fin
      ? proche((q) => Boolean(q.pose_fin) && (p.pose_fin === q.pose_fin || ressemblance(p.pose_fin!, q.pose_fin!) >= 0.9), true)
      : 0;
    if (fin) ajouter(p.id, `Même pose de fin que le plan ${fin} : chaque fin doit préparer le plan suivant.`);
    const photo = proche((q) => ressemblance(p.image_description, q.image_description, communsPhoto) >= 0.8, true);
    if (photo) ajouter(p.id, `Photo presque identique à celle du plan ${photo} : changez le cadrage, l'angle ou l'action.`);
    const prec = plans[i - 1];
    const continu = continus[i];
    const nouveauPlan = continu.morceau === 1;
    if (nouveauPlan && prec && p.cadrage && p.angle && p.cadrage === prec.cadrage && p.angle === prec.angle)
      ajouter(p.id, `Même cadrage et même angle que le plan ${i} : les deux plans vont sembler collés.`);
    if (!nouveauPlan && prec && (p.cadrage !== prec.cadrage || p.angle !== prec.angle))
      ajouter(p.id, `Cadrage ou angle différent du plan ${i} dans le même plan continu : gardez les mêmes, sinon l'image saute.`);

    // Durée du plan continu (sur sa première ligne) : une interview ne doit pas changer de plan toutes les 5 s
    if (nouveauPlan) {
      const lignes = plans.slice(i, i + continu.morceaux);
      const total = lignes.reduce((n, l) => n + Number(l.duration_s || 5), 0);
      const dernier = continus.at(-1)!.numero === continu.numero;
      if (total < cat.planMin && !dernier)
        ajouter(
          p.id,
          continu.morceaux === 1
            ? `Plan seul de ${total} s : en « ${cat.libelle} », gardez le même plan au moins ${cat.planMin} s (même numéro de plan continu sur les lignes suivantes).`
            : `Plan continu de ${total} s : en « ${cat.libelle} », gardez-le au moins ${cat.planMin} s.`,
        );
      if (total > cat.planMax)
        ajouter(p.id, `Plan continu de ${total} s : en « ${cat.libelle} », coupez-le vers ${cat.planMax} s au plus, à la fin d'une phrase.`);
      if (categorie === "interview" && prec?.voiceover_text.trim() && !/[.!?…»"”]\s*$/.test(prec.voiceover_text.trim()))
        ajouter(p.id, `Changement de plan au milieu d'une phrase (plan ${i} → ${i + 1}) : continuez le plan jusqu'à la fin de la phrase.`);
    }

    // Lieux : un changement de décor au milieu d'une phrase, ou un lieu tenu un seul plan, casse le réalisme
    const suiv = plans[i + 1];
    if (prec && p.lieu && prec.lieu && p.lieu !== prec.lieu) {
      if (prec.voiceover_text.trim() && !/[.!?…»"”]\s*$/.test(prec.voiceover_text.trim()))
        ajouter(p.id, `Changement de lieu au milieu d'une phrase (plan ${i} → ${i + 1}) : gardez « ${prec.lieu} » jusqu'à la fin de la phrase.`);
      if (suiv?.lieu && suiv.lieu !== p.lieu)
        ajouter(p.id, `Un seul plan dans « ${p.lieu} » : restez plus longtemps dans un même lieu, ne changez que le cadrage, l'angle ou le geste.`);
    }

    const voix = dureeVoix(p.voiceover_text);
    const duree = Number(p.duration_s || 5);
    if (duree > DUREE_MAX)
      ajouter(p.id, `Plan de ${duree} s : au-delà de ${DUREE_MAX} s la vidéo se dégrade, coupez la réplique en deux plans.`);
    else if (voix > duree + 0.5)
      ajouter(p.id, `Voix off d'environ ${Math.ceil(voix)} s pour un plan de ${duree} s : raccourcissez le texte ou coupez en deux plans.`);

    if (mouvementParDefaut && p.motion_prompt === mouvementParDefaut)
      ajouter(p.id, "Mouvement passe-partout : écrivez le geste propre à cette réplique.");
    if (pasEnAnglais(p.motion_prompt))
      ajouter(p.id, "Mouvement écrit en français ou en malgache : le modèle vidéo comprend surtout l'anglais.");
  });
  return alertes;
}
