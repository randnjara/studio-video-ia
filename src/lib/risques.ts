// Prévention des risques de la vidéo générée, surtout en lip-sync (la bouche est pilotée par la voix off) :
// règles données à l'assistant (tableau et vérification), détection des plans à risque avec un score et la raison, et
// correction automatique proposée de « prompt_video ». Aucun appel extérieur, aucun import : testable seul.

export type PlanRisque = {
  id: string;
  motion_prompt: string;
  cadrage?: string | null;
  pose_debut?: string | null;
  pose_fin?: string | null;
  intention?: string | null;
  lieu?: string | null;
};

export type Raison = { code: string; texte: string; poids: number };
export type Risque = { id: string; numero: number; score: number; niveau: "faible" | "moyen" | "élevé"; raisons: Raison[]; correction: string | null };

// Ordre des cadrages, du plus serré au plus large (mêmes libellés que la fiche de tournage)
const ORDRE_CADRAGES = [
  "très gros plan",
  "gros plan",
  "plan rapproché",
  "plan poitrine",
  "plan taille",
  "plan américain",
  "plan moyen",
  "plan large",
  "plan d'ensemble",
];

// Les 7 règles, telles que l'assistant les reçoit (consigne du tableau et vérification)
export const REGLES_RISQUES = `PRÉVENTION DES RISQUES (par défaut, surtout pour le lip-sync, où la bouche est animée par la voix off) :
R1. CAMÉRA : jamais de recul ni de passage à un cadrage plus large en cours de film (seulement des rapprochements lents, ou le même cadrage) ; jamais de mouvement qui fait entrer dans le cadre des parties du corps hors champ (mains, genoux, jambes).
R2. VISAGE : pas de rire franc ni de tête inclinée ou penchée ; sourire léger, tête droite face caméra ou en 3/4 léger, rotation de la tête de 15° au plus.
R3. ÉMOTION : une émotion forte passe par les yeux, la respiration et les sourcils, JAMAIS par la bouche (pas de lèvres pressées ou pincées, de menton qui tremble, de bouche ouverte, de pleurs ni de larmes) : la bouche est pilotée par la voix.
R4. MAINS : visibles et calmes, jamais devant le visage ni près de la bouche ; gestes lents et petits ; pas de doigts détaillés (pas d'index levé, pas de doigt pointé, pas de compter sur les doigts).
R5. STABILITÉ : pas d'objet tenu, pas de cheveux ni de voile qui passent devant le visage, éclairage stable, pas de changement de lieu ni de tenue.
R6. ARCS DE CAMÉRA : 15° au plus, et lents.
R7. PAROLE : en lip-sync, « prompt_video » n'évoque jamais la parole ni la bouche (pas de "speaks", "says", "talks", "lips", "mouth").`;

// Objets tenus à éviter (les mains et le visage restent libres)
const OBJETS =
  "cup|mug|glass|phone|smartphone|book|notebook|bag|handbag|basket|bottle|letter|photo|photograph|picture|flowers?|bouquet|paper|papers|pen|plate|bowl|baby|child|object|box|gift|card|tool|spoon|knife|fork|microphone|tablet|umbrella|fan";

type Regle = { code: string; poids: number; texte: string; motif: RegExp; lipsyncSeulement?: boolean; francais?: boolean };

// Motifs cherchés dans prompt_video (anglais) ; ceux marqués « francais » dans les poses et l'intention
const REGLES: Regle[] = [
  {
    code: "recul",
    poids: 3,
    texte: "R1 · recul ou cadrage plus large en cours de film",
    motif: /\b(pull(s|ed|ing)?[- ](back|out)|zoom(s|ed|ing)?[- ]out|dolly(ing)?[- ](back|out)|widen(s|ed|ing)?|(to|into|reveals?) a wider (shot|frame|framing)|camera (moves|steps|drifts|tracks|backs) (back|away)|reveal(s|ing)? (her|his|the) (full|whole) body)\b/i,
  },
  {
    code: "corps-entrant",
    poids: 3,
    texte: "R1 · des parties du corps entrent dans le cadre",
    motif: /\b(hands?|arms?|knees?|legs?|feet|lap|fingers?)\b[^.;]{0,40}\b(come|comes|coming|enter|enters|entering|rise|rises|rising|appear|appears)\b[^.;]{0,15}\b(into|in) (the )?(frame|view|shot)\b|\binto (the )?frame\b/i,
  },
  { code: "recul-fr", poids: 3, francais: true, texte: "R1 · recul de caméra dans la pose", motif: /(recul|plus large|élargi|dézoom)/i },
  {
    code: "rire",
    poids: 3,
    texte: "R2 · rire franc",
    motif: /\b(laugh(s|ing|ed)?|giggl\w*|chuckl\w*|bursts? out|big (grin|smile)|grins? widely|broad grin)\b/i,
  },
  { code: "rire-fr", poids: 3, francais: true, texte: "R2 · rire dans la pose ou l'intention", motif: /(^|[\s,.;:'’(])(rit|rire|éclate de rire|éclat de rire|rieuse|rieur|en riant)(?=[\s,.;:)!]|$)/i },
  {
    code: "tete",
    poids: 2,
    texte: "R2 · tête inclinée, penchée ou tournée",
    motif: /\b(tilt(s|ed|ing)? (her|his|the) head|head (tilted|tilts|tilting|cocked|tipped)|cocks? (her|his) head|leans? (her|his) head|tips? (her|his) head|turns? (her|his) head (to the side|away|sideways|fully)|looks? away|turns? (away|around)|profile view)\b/i,
  },
  { code: "tete-fr", poids: 2, francais: true, texte: "R2 · tête inclinée ou penchée dans la pose", motif: /(tête (inclinée|penchée|de côté|tournée)|penche la tête|incline la tête|de profil)/i },
  {
    code: "bouche-emotion",
    poids: 3,
    texte: "R3 · émotion par la bouche (lèvres, menton, pleurs)",
    motif: /\b(press(es|ed|ing)? (her|his) lips|purs(es|ed) (her|his) lips|lips? (press|pressed|tremble|trembling|quiver|quivering|part|parted)|(chin|lips?) (trembles|quivers|trembling|quivering)|mouth (open|opens|agape|wide)|opens? (her|his) mouth|cr(y|ies|ying)|tears?\b|tearful|sob(s|bing)?|bites? (her|his) lip|weep\w*)\b/i,
  },
  {
    code: "bouche-emotion-fr",
    poids: 3,
    francais: true,
    texte: "R3 · émotion par la bouche dans la pose ou l'intention",
    motif: /(lèvres (pincées|pressées|serrées|tremblantes)|menton (qui )?tremble|bouche (ouverte|bée)|pleur|larmes|sanglot)/i,
  },
  {
    code: "mains-visage",
    poids: 3,
    texte: "R4 · main devant le visage ou près de la bouche",
    motif: /\b(hands?|fingers?|palms?)\b[^.;]{0,25}\b(to|near|over|on|against|in front of|cover(s|ing)?|touch(es|ing)?|cup(s|ping)?)\b[^.;]{0,10}\b(her|his|the)? ?(face|mouth|lips|chin|cheeks?|eyes)\b|\bcovers? (her|his) (mouth|face|eyes)\b|\bwip(es|ing) (her|his) (tears|eyes)\b/i,
  },
  {
    code: "mains-visage-fr",
    poids: 3,
    francais: true,
    texte: "R4 · main devant le visage dans la pose",
    motif: /mains?( [^\s,.;]+){0,2} (sur|devant|contre|près de|à) (le |la |sa |son |ses )?(visage|bouche|menton|joue|yeux|lèvres)/i,
  },
  {
    code: "doigts",
    poids: 2,
    texte: "R4 · doigts détaillés (index levé, compter sur les doigts)",
    motif: /\b(index finger|points? (a |her |his |one )?finger|pointing|counts? on (her|his) fingers|counting|raises? (one|a|her|his) finger|wags? (a|her|his) finger|thumbs? up|fingers? (spread|interlaced|interlocked|snap)|snaps? (her|his) fingers)\b/i,
  },
  { code: "doigts-fr", poids: 2, francais: true, texte: "R4 · doigts détaillés dans la pose", motif: /(index (levé|pointé)|doigt (levé|pointé)|compte sur ses doigts|pouce levé)/i },
  {
    code: "geste-rapide",
    poids: 1,
    texte: "R4 · geste rapide ou ample",
    motif: /\b(quickly|rapid(ly)?|sudden(ly)?|energetic(ally)?|abrupt(ly)?|wide gesture|sweeping gesture|throws? (her|his) (arms|hands)|claps?)\b/i,
  },
  {
    code: "objet",
    poids: 2,
    texte: "R5 · objet tenu",
    motif: new RegExp(`\\b(picks? up|grabs?|holds?|holding|carr(y|ies|ying)|lifts?) (a|an|the|her|his) (${OBJETS})\\b`, "i"),
  },
  {
    code: "cheveux",
    poids: 2,
    texte: "R5 · cheveux ou voile devant le visage",
    motif: /\b(hair|veil|scarf|headscarf|strands?)\b[^.;]{0,25}\b(falls?|blows?|blowing|covers?|across|over (her|his) (face|eyes)|in front of)\b/i,
  },
  {
    code: "lumiere",
    poids: 1,
    texte: "R5 · éclairage qui change",
    motif: /\b(light(ing)? (changes|shifts|flickers|dims|brightens|fades)|shadows? (cross|crosses|passes|sweeps)|sun (comes out|sets|breaks through)|flicker\w*)\b/i,
  },
  {
    code: "tenue-lieu",
    poids: 2,
    texte: "R5 · changement de tenue ou de lieu dans le clip",
    motif: /\b(changes? (her|his) (clothes|outfit|dress)|puts? on (a|her|his) (coat|jacket|hat|scarf|glasses)|takes? off (her|his)|walks? (out|into another room|to another place)|cuts? to (a|another))\b/i,
  },
  {
    code: "arc",
    poids: 2,
    texte: "R6 · arc ou rotation de caméra de plus de 15°",
    motif: /\b(orbit\w*|circles? around|rotates? around|360|180[- ]degree|half[- ]circle|sweeping arc|wide arc|fast arc)\b/i,
  },
  {
    code: "parole",
    poids: 2,
    lipsyncSeulement: true,
    texte: "R7 · prompt_video évoque la parole ou la bouche (lip-sync)",
    motif: /\b(speaks?|speaking|spoke|says|saying|said|talks?|talking|whispers?|whispering|sings?|singing|tells?|explains?|announces?|lips?|mouth)\b/i,
  },
];

// Arc chiffré au-delà de 15° (« a slow 30° arc », « arcs 25 degrees »)
const ARC_CHIFFRE = /\b(\d{2,3})\s*(°|degrees?\b)[^.;]{0,20}\b(arc|orbit|rotation|turn)|\b(arc|orbit|rotat\w*|turn\w*)\b[^.;]{0,20}\b(\d{2,3})\s*(°|degrees?)/i;

export function niveauDe(score: number): Risque["niveau"] {
  return score >= 5 ? "élevé" : score >= 3 ? "moyen" : "faible";
}

// Raisons de risque d'un plan (« precedent » : le plan d'avant, pour repérer un passage à un cadrage plus large)
export function raisonsPlan(p: PlanRisque, precedent: PlanRisque | undefined, lipsync: boolean): Raison[] {
  const raisons: Raison[] = [];
  const vues = new Set<string>();
  const ajouter = (code: string, texte: string, poids: number) => {
    const famille = code.replace(/-fr$/, "");
    if (vues.has(famille)) return;
    vues.add(famille);
    raisons.push({ code: famille, texte, poids });
  };
  const anglais = p.motion_prompt ?? "";
  const francais = [p.pose_debut, p.pose_fin, p.intention].filter(Boolean).join(" · ");
  for (const r of REGLES) {
    if (r.lipsyncSeulement && !lipsync) continue;
    if (r.motif.test(r.francais ? francais : anglais)) ajouter(r.code, r.texte, r.poids);
  }
  const arc = anglais.match(ARC_CHIFFRE);
  if (arc && Number(arc[1] ?? arc[5]) > 15) ajouter("arc", `R6 · arc de caméra de ${arc[1] ?? arc[5]}° (15° au plus)`, 2);
  // Cadrage plus large que le plan d'avant (on ne recule jamais en cours de film)
  const i = ORDRE_CADRAGES.indexOf(precedent?.cadrage ?? "");
  const j = ORDRE_CADRAGES.indexOf(p.cadrage ?? "");
  if (i >= 0 && j > i) ajouter("recul", `R1 · passage de « ${precedent!.cadrage} » à « ${p.cadrage} », plus large`, 3);
  return raisons;
}

// Réécritures sûres de prompt_video : chaque motif risqué est remplacé par sa version calme
const REECRITURES: [RegExp, string][] = [
  [/\b(the )?camera (slowly |gently )?(pull(s|ed|ing)?[- ](back|out)|zoom(s|ed|ing)?[- ]out|dolly(ing)?[- ](back|out)|moves back|steps back|drifts back|backs away)\b[^,.;]*/gi, "the camera holds the same framing"],
  [/\b(slow(ly)? )?(pull(s|ed|ing)?[- ](back|out)|zoom(s|ed|ing)?[- ]out|dolly(ing)?[- ](back|out))\b[^,.;]*/gi, "camera holds the same framing"],
  [/\b(widen(s|ed|ing)?|(to|into|reveals?) a wider (shot|frame|framing))\b[^,.;]*/gi, "the framing stays the same"],
  [/\b(hands?|arms?|knees?|legs?|feet|fingers?)\b[^.;,]{0,40}\b(come|comes|coming|enter|enters|entering|rise|rises|rising|appear|appears)\b[^.;,]{0,15}\b(into|in) (the )?(frame|view|shot)\b/gi, "hands stay calm and out of view"],
  [/\b(laugh(s|ing|ed)?( softly| warmly| gently)?|giggl\w*|chuckl\w*|bursts? out laughing|grins? widely)\b/gi, "smiles softly"],
  [/\b(big|broad) (grin|smile)\b/gi, "light smile"],
  [/\b(tilt(s|ed|ing)?|cocks?|leans?|tips?) (her|his|the) head\b[^,.;]*/gi, "keeps the head straight, facing the camera"],
  [/\bhead (tilted|tilts|tilting|cocked|tipped)\b[^,.;]*/gi, "head straight, facing the camera"],
  [/\bturns? (her|his) head (to the side|away|sideways|fully)\b/gi, "turns the head slightly, under 15 degrees"],
  [/\b(looks? away|turns? (away|around))\b/gi, "glances slightly aside, then back to the camera"],
  [/\b(press(es|ed|ing)?|purs(es|ed)) (her|his) lips( together)?\b/gi, "her eyes soften and she takes a slow breath"],
  [/\b((her|his) )?(chin|lips?) (trembles?|quivers?|trembling|quivering)\b/gi, "her eyes glisten and her brows lift slightly"],
  [/\bbites? (her|his) lip\b/gi, "her brows draw together slightly"],
  [/\b(opens? (her|his) mouth|(her|his) mouth (opens|falls open|agape|wide open))\b/gi, "her eyes widen slightly"],
  [/\b(cr(ies|ying)|sobs?|sobbing|weeps?|weeping|tears (roll|run|stream)[^,.;]*|tearful)\b/gi, "her eyes glisten, she breathes slowly"],
  [/\b(wip(es|ing) (her|his) (tears|eyes)|covers? (her|his) (mouth|face|eyes)( with (her|his) hands?)?)\b/gi, "her hands rest calmly at chest height"],
  [/\b(raises?|brings?|puts?|places?|lifts?|moves?) (her|his|a|one|both) (hands?|fingers?|palms?) (to|near|over|on|against|in front of) (her|his|the) (face|mouth|lips|chin|cheeks?|eyes)\b/gi, "rests her hands calmly at chest height"],
  [/\b(hands?|fingers?|palms?) (to|near|over|on|against|in front of) (her|his|the) (face|mouth|lips|chin|cheeks?|eyes)\b/gi, "hands calm at chest height"],
  [/\b(raises?|lifts?) (her|his|an|the) index finger\b[^,.;]*/gi, "makes a small slow open-hand gesture"],
  [/\b(points? (a |her |his |one )?finger|pointing|counts? on (her|his) fingers|counting on (her|his) fingers|raises? (one|a) finger|wags? (a|her|his) finger|thumbs? up|snaps? (her|his) fingers)\b[^,.;]*/gi, "makes a small slow open-hand gesture"],
  [/\b(quickly|rapidly|suddenly|energetically|abruptly)\b/gi, "slowly"],
  [/\b(wide|sweeping) gesture\b/gi, "small gesture"],
  [new RegExp(`\\b(picks? up|grabs?|holds?|holding|carr(y|ies|ying)|lifts?) (a|an|the|her|his) (${OBJETS})\\b[^,.;]*`, "gi"), "keeps her hands empty and calm"],
  [/\b(hair|veil|scarf|headscarf|strands?( of hair)?)\b[^.;,]{0,25}\b(falls?|blows?|blowing|covers?|across|in front of)\b[^,.;]*/gi, "hair stays neatly in place, away from the face"],
  [/\b(light(ing)? (changes|shifts|flickers|dims|brightens|fades)|shadows? (cross|crosses|passes|sweeps)[^,.;]*|sun (comes out|sets|breaks through))\b/gi, "lighting stays constant"],
  [/\b(the camera )?(orbit\w*|circles? around|rotates? around|360|180[- ]degree|half[- ]circle|sweeping arc|wide arc|fast arc)\b[^,.;]*/gi, "the camera makes a very slow arc of at most 15 degrees"],
  [/\b(\d{2,3})\s*(°|degrees?\b)/gi, "15 degrees"],
];

// Réécritures du lip-sync : la parole et la bouche sortent de prompt_video
const REECRITURES_LIPSYNC: [RegExp, string][] = [
  [/,?\s*\b(while|as) (she|he|they) (speaks?|says?|talks?|tells?|explains?|whispers?|sings?)\b[^,.;]*/gi, ""],
  [/\b(she|he|they) (speaks?|says?|talks?|tells?|explains?|whispers?|announces?|sings?)( \w+ly)?\b[^,.;]*/gi, "$1 keeps a gentle expression"],
  [/\b(speaking|talking|saying|whispering|singing)\b[^,.;]*/gi, "with a gentle expression"],
  [/\b(her|his|the) (lips|mouth)\b[^,.;]*/gi, "her face relaxed"],
];

const nettoyer = (t: string) =>
  t
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([,;])\s*([,;.])/g, "$2")
    .replace(/\s{2,}/g, " ")
    .trim();

// prompt_video corrigé, ou null si rien n'est à changer
export function corrigerPrompt(prompt: string, lipsync: boolean): string | null {
  let t = prompt;
  for (const [motif, remplace] of [...REECRITURES, ...(lipsync ? REECRITURES_LIPSYNC : [])]) t = t.replace(motif, remplace);
  t = nettoyer(t);
  return t !== prompt.trim() ? t : null;
}

// Plans à risque, du plus risqué au moins risqué (les plans sans risque n'y sont pas)
export function risquesPlans(plans: PlanRisque[], lipsync: boolean): Risque[] {
  return plans
    .map((p, i) => {
      const raisons = raisonsPlan(p, plans[i - 1], lipsync);
      const score = raisons.reduce((n, r) => n + r.poids, 0);
      return { id: p.id, numero: i + 1, score, niveau: niveauDe(score), raisons, correction: score > 0 ? corrigerPrompt(p.motion_prompt ?? "", lipsync) : null };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.numero - b.numero);
}
