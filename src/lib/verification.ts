// Prompt de vérification du script et des plans, à coller dans un assistant gratuit (ChatGPT, Claude, Gemini…).
// Rien n'est envoyé par le studio : la personne copie le texte et le colle elle-même.
type PlanVerif = {
  position: number;
  motion_prompt: string;
  voiceover_text: string;
  duration_s: number;
  image_description?: string;
  cadrage?: string;
  angle?: string;
  lieu?: string;
  intention?: string;
  pose_debut?: string;
  pose_fin?: string;
};

export function promptVerification(projet: { title: string; aspect_ratio: string; scenario_text: string }, plans: PlanVerif[]) {
  const liste = plans
    .map(
      (p, i) =>
        `PLAN ${i + 1} (${Number(p.duration_s || 5)} s)\n` +
        (p.image_description?.trim() ? `- Photo de départ : ${p.image_description.trim()}\n` : "") +
        ([p.cadrage, p.angle, p.lieu, p.intention].some(Boolean)
          ? `- Fiche : ${[p.cadrage, p.angle, p.lieu, p.intention].filter(Boolean).join(" · ")}\n`
          : "") +
        (p.pose_debut || p.pose_fin ? `- Pose début → fin : ${p.pose_debut || "?"} → ${p.pose_fin || "?"}\n` : "") +
        `- Mouvement / consigne vidéo : ${p.motion_prompt.trim() || "(vide)"}\n` +
        `- Voix off : ${p.voiceover_text.trim() || "(aucune)"}`,
    )
    .join("\n\n");

  return `Tu es scripte (responsable de la continuité) et réalisateur sur un film tourné entièrement en vidéo générée par IA.
Chaque plan est un clip de quelques secondes créé par le modèle Wan 2.2 « image vers vidéo » : il part d'une PHOTO DE DÉPART et l'anime selon la consigne de mouvement. Le modèle ne connaît ni les autres plans ni le script : toute la continuité dépend donc des photos de départ et des consignes.

FILM : « ${projet.title} » — format ${projet.aspect_ratio}

=== SCRIPT COMPLET ===
${projet.scenario_text.trim() || "(aucun script enregistré)"}

=== PLANS, DANS L'ORDRE DU MONTAGE ===
${liste || "(aucun plan)"}

=== CE QUE TU DOIS VÉRIFIER ===
1. Respect du script : chaque moment important du script a-t-il son plan ? Y a-t-il des plans hors script, en double ou dans le mauvais ordre ?
2. Continuité entre plans voisins : personnages (visage, âge, coiffure, vêtements, accessoires), objets, lieu, moment de la journée, météo, lumière, couleurs, direction du regard et du déplacement à l'écran (règle des 180°), position de fin d'un plan et position de début du suivant.
3. Qualité de chaque consigne de mouvement pour Wan 2.2 :
   - une seule action principale, réalisable dans la durée indiquée du plan, sans changement de plan ni coupe à l'intérieur ;
   - mouvement de caméra précis (fixe, travelling avant, panoramique lent…) ;
   - sujet, action, ambiance et lumière décrits en mots simples et concrets ;
   - rien qui contredise ce que montre la photo de départ (personne absente, décor différent) ;
   - pas de texte à afficher à l'écran, pas de visage qui change, pas de foule détaillée inutile.
4. Variété : aucun geste, cadrage ou angle ne doit revenir en boucle (comparer chaque plan aux 10 précédents et aux 10 suivants) ; chaque geste doit correspondre au sens de la réplique, pas à un cycle répété.
5. Raccords : la pose de fin d'un plan doit pouvoir enchaîner avec la pose de début du suivant (regard, tête, mains, côté du corps) ; sinon proposer une coupe motivée (changement net de cadrage).
6. Langue : les consignes de mouvement doivent être en anglais ; les répliques restent dans leur langue d'origine, sans modification.
7. Voix off : longueur compatible avec la durée du plan (environ 2,5 mots par seconde), ton cohérent d'un plan à l'autre.
8. Si je te joins les photos de départ (dans l'ordre des plans), compare-les entre elles et avec les consignes : signale tout ce qui casse la continuité.

=== RÉPONSE ATTENDUE (en français simple) ===
A. Un tableau : Plan | Verdict (OK / À corriger) | Problème en une phrase | Consigne de mouvement corrigée en anglais, découpée 0–1 s / 1–3 s / 3–4 s / 4–5 s, prête à copier.
B. La liste des problèmes de continuité entre plans voisins, du plus grave au moins grave, avec la correction proposée (consigne à changer, ou photo de départ à refaire et ce qu'elle doit montrer).
C. Les moments du script qui manquent, et les plans à ajouter (consigne + voix off).
D. Une « fiche de continuité » courte à garder pour tout le film : personnages, tenues, lieux, palette de couleurs, lumière et style de caméra à répéter dans chaque consigne.
Ne réécris pas les plans qui sont déjà bons.`;
}
