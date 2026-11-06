// Étapes d'un travail serveur (RunPod) et lecture de ses nouvelles : calculs sans réseau ni import, partagés par le
// serveur (enregistrement), la frise en direct et la page Historique. Testables seuls.

export const ETAPES = ["envoye", "file", "demarrage", "telechargement", "calcul", "envoi", "termine"] as const;
export type Etape = (typeof ETAPES)[number] | "echoue" | "annule";
export const FINALES: Etape[] = ["termine", "echoue", "annule"];

export const LIBELLES_ETAPES: Record<Etape, string> = {
  envoye: "Envoyé au serveur",
  file: "En file d'attente RunPod",
  demarrage: "Le serveur démarre",
  telechargement: "Modèle en téléchargement",
  calcul: "Calcul en cours",
  envoi: "Envoi du résultat",
  termine: "Terminé",
  echoue: "Échoué",
  annule: "Annulé",
};

export const LIBELLES_TYPES: Record<string, string> = {
  voix: "Voix (texte → voix)",
  "voix-transformation": "Voix transformée",
  decoupe: "Découpe de la voix off",
  calage: "Calage des plans sur la voix (Whisper)",
  transcription: "Transcription de la voix (Whisper)",
  photo: "Photo de départ",
  video: "Vidéo",
  "video-qualite": "Vidéo (Qualité max)",
  "video-vace": "Vidéo (Visage fidèle)",
  lipsync: "Vidéo lip-sync",
  "serveur-arret": "Serveurs arrêtés",
  "serveur-redemarrage": "Serveurs redémarrés",
  "serveur-image": "Nouvelle image du serveur",
  "serveur-creation": "Serveur créé",
  "serveur-sante": "Machine en mauvaise santé (RunPod)",
};

export const estFinale = (e: string) => (FINALES as string[]).includes(e);

// Message d'erreur lisible, à partir du texte technique renvoyé par le serveur
export function erreurLisible(detail: string | null | undefined): string {
  const t = String(detail ?? "");
  if (!t) return "Le serveur n'a pas donné de raison.";
  if (/non compatible avec l'image/i.test(t)) return t.split("\n")[0].slice(0, 300);
  if (/no kernel image is available|sm_\d+ is not compatible/i.test(t))
    return "La carte graphique attribuée n'est pas gérée par l'image du serveur (CUDA trop ancien) : limitez le serveur aux cartes compatibles ou mettez l'image à jour.";
  if (/unhealthy/i.test(t)) return "RunPod signale une machine en mauvaise santé (le serveur plante au démarrage).";
  if (/out of memory|CUDA out of memory|OutOfMemory/i.test(t)) return "La mémoire de la carte graphique est pleine : réessayez, ou en résolution plus petite.";
  if (/TIMED_OUT|timeout|timed out|executionTimeout/i.test(t)) return "Le calcul a dépassé le temps permis par RunPod.";
  if (/CANCELLED|annul/i.test(t)) return "Le travail a été annulé.";
  if (/ModuleNotFoundError|ImportError|No module named/i.test(t)) return "L'image du serveur est incomplète (bibliothèque manquante) : il faut la reconstruire.";
  if (/Champ manquant|Missing|required/i.test(t)) return "La demande envoyée au serveur était incomplète.";
  if (/Envoi .*refusé|upload|403|signature/i.test(t)) return "Le serveur n'a pas pu déposer le résultat dans le stockage (lien expiré ou refusé).";
  if (/404|Not Found|introuvable/i.test(t)) return "Un fichier demandé est introuvable.";
  if (/No space left|disk/i.test(t)) return "Le disque du serveur est plein.";
  if (/paused|arrêté/i.test(t)) return "Le serveur est arrêté.";
  if (/Whisper/i.test(t)) return "Whisper n'a pas pu transcrire la voix off.";
  if (/RunPod a répondu (5\d\d)/.test(t)) return "RunPod ne répond pas pour l'instant : réessayez dans une minute.";
  return t.split("\n")[0].slice(0, 160);
}

export type Nouvelle = {
  etape: Etape;
  message: string;
  progression: number | null;
  erreur?: string;
  erreurDetail?: string;
  secondes?: number | null;
};

// Progression envoyée par un worker (runpod.serverless.progress_update) : {"etape", "pct", "message"} ou « etape|pct|message »
export function lireProgression(sortie: unknown): Pick<Nouvelle, "etape" | "message" | "progression"> | null {
  type Brut = { etape?: unknown; pct?: unknown; message?: unknown };
  let o: Brut | null = null;
  if (sortie && typeof sortie === "object" && !Array.isArray(sortie)) o = sortie as Brut;
  else if (typeof sortie === "string") {
    try {
      const j = JSON.parse(sortie);
      if (j && typeof j === "object") o = j;
    } catch {
      const [etape, pct, ...reste] = sortie.split("|");
      o = reste.length || pct !== undefined ? { etape, pct, message: reste.join("|") } : { etape: "calcul", message: sortie };
    }
  }
  if (!o) return null;
  const etape = (ETAPES as readonly string[]).includes(String(o.etape)) ? (o.etape as Etape) : "calcul";
  const pct = o.pct === null || o.pct === undefined || o.pct === "" ? null : Number(o.pct);
  return {
    etape,
    message: String(o.message ?? "").slice(0, 300),
    progression: pct !== null && Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct * 10) / 10)) : null,
  };
}

// Nouvelle d'un travail d'après la réponse /status de RunPod
export function lireEtatRunPod(data: { status?: string; output?: unknown; error?: unknown; executionTime?: number; delayTime?: number }): Nouvelle {
  const secondes = typeof data.executionTime === "number" ? Math.round(data.executionTime / 10) / 100 : null;
  switch (data.status) {
    case "IN_QUEUE":
      return { etape: "file", message: "En attente d'une machine RunPod libre", progression: null };
    case "IN_PROGRESS": {
      const p = lireProgression(data.output);
      return p ?? { etape: "calcul", message: "", progression: null };
    }
    case "COMPLETED": {
      const sortie = data.output as { error?: unknown } | undefined;
      if (sortie?.error) {
        const detail = String(sortie.error).slice(0, 2000);
        return { etape: "echoue", message: "", progression: null, erreur: erreurLisible(detail), erreurDetail: detail, secondes };
      }
      return { etape: "termine", message: "", progression: 100, secondes };
    }
    case "CANCELLED":
      return { etape: "annule", message: "Annulé chez RunPod", progression: null, secondes };
    case "FAILED":
    case "TIMED_OUT": {
      const detail = String(data.error ?? data.status).slice(0, 2000);
      return { etape: "echoue", message: "", progression: null, erreur: erreurLisible(detail), erreurDetail: detail, secondes };
    }
    default:
      return { etape: "file", message: "", progression: null };
  }
}

// Sorte de travail et projet, lus dans la demande envoyée au serveur (les chemins du stockage commencent par le projet)
export function typeDuTravail(cible: string, input: Record<string, unknown>): string {
  if (cible === "qualite") return "video-qualite";
  if (cible === "fidele-480" || input.mode === "vace") return "video-vace";
  if (cible === "lipsync" || input.mode === "lipsync") return "lipsync";
  if (cible === "photo" || input.mode === "image") return "photo";
  if (cible === "voix") {
    if (input.moteur === "decouper") return "decoupe";
    if (input.moteur === "aligner") return "calage";
    if (input.moteur === "transcrire") return "transcription";
    if (input.moteur === "conversion") return "voix-transformation";
    return "voix";
  }
  return "video";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function projetDuTravail(input: Record<string, unknown>): string | null {
  const morceaux = Array.isArray(input.morceaux) ? (input.morceaux as { audio_path?: unknown }[]) : [];
  for (const v of [input.projet_id, input.video_path, input.image_path, input.audio_path, morceaux[0]?.audio_path]) {
    const premier = typeof v === "string" ? v.split("/")[0] : "";
    if (UUID.test(premier)) return premier;
  }
  return null;
}

export type Evenement = { created_at: string; etape: string; message: string; progression: number | null };
export type EtapeFrise = {
  etape: Etape;
  libelle: string;
  etat: "fait" | "en_cours" | "echoue" | "a_venir";
  debut: string | null;
  duree: number | null; // secondes
  message: string;
  progression: number | null;
};

// Frise d'un travail : les étapes vues (dans l'ordre, chacune avec son heure, sa durée, son dernier message et son %), et
// le silence du serveur (minutes sans nouvelle) tant que le travail n'est pas fini
export function frise(evenements: Evenement[], statut: string, maintenant = Date.now()) {
  const tries = [...evenements].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const vues: EtapeFrise[] = [];
  for (const e of tries) {
    const etape = (e.etape in LIBELLES_ETAPES ? e.etape : "calcul") as Etape;
    const derniere = vues.at(-1);
    if (derniere?.etape === etape) {
      derniere.message = e.message || derniere.message;
      derniere.progression = e.progression ?? derniere.progression;
      continue;
    }
    if (derniere) derniere.duree = (new Date(e.created_at).getTime() - new Date(derniere.debut!).getTime()) / 1000;
    vues.push({ etape, libelle: LIBELLES_ETAPES[etape], etat: "fait", debut: e.created_at, duree: null, message: e.message, progression: e.progression });
  }
  const fini = estFinale(statut);
  const derniere = vues.at(-1);
  if (derniere) {
    if (derniere.etape === "echoue" || derniere.etape === "annule") derniere.etat = "echoue";
    else if (!fini) {
      derniere.etat = "en_cours";
      derniere.duree = (maintenant - new Date(derniere.debut!).getTime()) / 1000;
    }
  }
  const dernierePreuve = tries.at(-1)?.created_at;
  const silenceMinutes = !fini && dernierePreuve ? Math.floor((maintenant - new Date(dernierePreuve).getTime()) / 60000) : 0;
  const total = tries.length ? (new Date(fini ? tries.at(-1)!.created_at : new Date(maintenant).toISOString()).getTime() - new Date(tries[0].created_at).getTime()) / 1000 : 0;
  return { etapes: vues, fini, silenceMinutes, total };
}

export const dureeLisible = (s: number | null | undefined) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return "";
  if (s < 60) return `${Math.max(0, Math.round(s))} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${String(Math.round(s - m * 60)).padStart(2, "0")} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};
