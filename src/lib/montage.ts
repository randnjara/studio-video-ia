// Montage à pistes : le modèle de la timeline et les calculs partagés par l'aperçu et l'export.
// Aucun appel réseau ici : ce fichier sert au navigateur comme au serveur.

export type Nature = "video" | "image" | "audio";
export type Fondu = "coupe" | "fondu" | "noir" | "blanc" | "glisse" | "volet" | "zoom";

// Les transitions proposées entre deux plans, avec leur nom et leur symbole sur la piste
export const TRANSITIONS: { valeur: Fondu; nom: string; symbole: string }[] = [
  { valeur: "coupe", nom: "Coupe nette", symbole: "│" },
  { valeur: "fondu", nom: "Fondu enchaîné", symbole: "⧉" },
  { valeur: "noir", nom: "Fondu au noir", symbole: "◐" },
  { valeur: "blanc", nom: "Fondu au blanc (flash)", symbole: "○" },
  { valeur: "glisse", nom: "Glissement (pousse le plan)", symbole: "⇠" },
  { valeur: "volet", nom: "Volet (balayage)", symbole: "▶" },
  { valeur: "zoom", nom: "Zoom d’arrivée", symbole: "⊕" },
];
export const symboleTransition = (f: Fondu) => TRANSITIONS.find((t) => t.valeur === f)?.symbole ?? "";

// Ces transitions font chevaucher deux plans ; le noir et le blanc passent entre les deux
const CHEVAUCHE: Fondu[] = ["fondu", "glisse", "volet", "zoom"];
const PASSAGE: Fondu[] = ["noir", "blanc"];
export type Zoom = "aucun" | "avant" | "arriere";

// Un fichier utilisable dans le montage (clip validé, photo de départ, fichier importé)
export type Media = {
  chemin: string; // chemin dans le stockage « medias »
  nature: Nature;
  nom: string;
  duree: number | null; // durée réelle du fichier, null pour une image
  takeId?: string; // clip généré par le studio
};

export type Element = Media & {
  id: string;
  debut: number; // position dans le film (s) ; calculée sur la piste principale
  coupeDebut: number; // ce qu'on enlève au début du fichier (s)
  longueur: number; // durée dans le film (s)
  volume: number; // 0 à 2 (1 = volume d'origine)
  entree: Fondu;
  sortie: Fondu;
  transition: number; // durée des fondus (s)
  zoom: Zoom;
};

export type Piste = {
  id: string;
  nature: "video" | "audio"; // une piste vidéo accepte aussi les images
  nom: string;
  volume: number;
  muet: boolean;
  elements: Element[];
};

// pistes[0] est la piste principale : ses plans se suivent sans trou, dans l'ordre
export type Timeline = { version: 1; pistes: Piste[]; bibliotheque: Media[] };

export const DUREE_IMAGE = 3;
export const DUREE_MIN = 0.3;
export const TRANSITION = 0.8;

export const DIMENSIONS: Record<string, Record<"480p" | "720p", [number, number]>> = {
  "9:16": { "480p": [480, 854], "720p": [720, 1280] },
  "16:9": { "480p": [854, 480], "720p": [1280, 720] },
  "1:1": { "480p": [480, 480], "720p": [720, 720] },
};

export const nouvelId = () => Math.random().toString(36).slice(2, 10);

export function nouvellePiste(nature: Piste["nature"], nom: string): Piste {
  return { id: nouvelId(), nature, nom, volume: 1, muet: false, elements: [] };
}

export function nouvelElement(media: Media, debut = 0): Element {
  return {
    ...media,
    id: nouvelId(),
    debut,
    coupeDebut: 0,
    longueur: media.nature === "image" ? DUREE_IMAGE : Math.max(DUREE_MIN, media.duree ?? 5),
    volume: 1,
    entree: "coupe",
    sortie: "coupe",
    transition: TRANSITION,
    zoom: media.nature === "image" ? "avant" : "aucun",
  };
}

export function timelineParDefaut(clips: Media[]): Timeline {
  const principale = { ...nouvellePiste("video", "Vidéo principale"), elements: clips.map((c) => nouvelElement(c)) };
  return {
    version: 1,
    pistes: [principale, nouvellePiste("video", "Images par-dessus"), nouvellePiste("audio", "Voix off"), nouvellePiste("audio", "Musique")],
    bibliotheque: [],
  };
}

// Lecture prudente d'une timeline enregistrée (ou envoyée par le navigateur)
export function lireTimeline(brut: unknown): Timeline | null {
  if (!brut || typeof brut !== "object") return null;
  const t = brut as Timeline;
  if (t.version !== 1 || !Array.isArray(t.pistes) || t.pistes.length === 0) return null;
  for (const p of t.pistes) if (!Array.isArray(p.elements) || (p.nature !== "video" && p.nature !== "audio")) return null;
  return { ...t, bibliotheque: Array.isArray(t.bibliotheque) ? t.bibliotheque : [] };
}

// Durée effective d'un fondu : jamais plus de la moitié du plan
function dureeFondu(e: Element, voisin?: Element) {
  return Math.max(0, Math.min(e.transition, e.longueur / 2, voisin ? voisin.longueur / 2 : Infinity));
}

export type Place = {
  element: Element;
  piste: Piste;
  niveau: number; // ordre d'empilement (piste)
  principale: boolean;
  debut: number;
  fin: number;
  fonduEntree: number; // 0 = coupe franche
  fonduSortie: number;
  entree: Fondu; // effet pendant fonduEntree
  sortie: Fondu; // effet pendant fonduSortie (noir, blanc ou fondu)
  pousse: number; // glissement : durée pendant laquelle le plan suivant pousse celui-ci hors du cadre
};

// Place chaque élément dans le temps. Sur la piste principale, un fondu enchaîné (ou un glissement, un volet, un zoom)
// fait chevaucher deux plans ; le fondu au noir ou au blanc passe par une image unie (moitié du temps chacun).
export function placer(timeline: Timeline): { places: Place[]; duree: number } {
  const places: Place[] = [];
  timeline.pistes.forEach((piste, niveau) => {
    const principale = niveau === 0;
    let curseur = 0;
    piste.elements.forEach((e, i) => {
      const avant = piste.elements[i - 1];
      const apres = piste.elements[i + 1];
      let debut = e.debut;
      let fonduEntree = e.entree === "coupe" ? 0 : dureeFondu(e);
      let fonduSortie = e.sortie === "coupe" ? 0 : dureeFondu(e);
      let entree: Fondu = e.entree;
      let sortie: Fondu = e.sortie;
      let pousse = 0;
      if (principale) {
        if (avant && CHEVAUCHE.includes(e.entree)) {
          fonduEntree = dureeFondu(e, avant);
          debut = curseur - fonduEntree;
        } else {
          debut = curseur;
          if (avant && PASSAGE.includes(e.entree)) fonduEntree = dureeFondu(e, avant) / 2;
          // Premier plan : un fondu enchaîné part du noir
          if (!avant && e.entree === "fondu") entree = "noir";
        }
        if (apres && PASSAGE.includes(apres.entree)) {
          fonduSortie = dureeFondu(apres, e) / 2;
          sortie = apres.entree;
        } else if (apres) {
          fonduSortie = 0;
          sortie = "coupe";
          if (apres.entree === "glisse") pousse = dureeFondu(apres, e);
        }
        curseur = debut + e.longueur;
      }
      places.push({ element: e, piste, niveau, principale, debut, fin: debut + e.longueur, fonduEntree, fonduSortie, entree, sortie, pousse });
    });
  });
  const duree = places.reduce((m, p) => Math.max(m, p.fin), 0);
  return { places, duree };
}

// Opacité (vidéo) ou enveloppe de volume (son) d'un élément à l'instant t
export function enveloppe(p: Place, t: number) {
  let a = 1;
  if (p.fonduEntree > 0 && t < p.debut + p.fonduEntree) a = Math.min(a, (t - p.debut) / p.fonduEntree);
  if (p.fonduSortie > 0 && t > p.fin - p.fonduSortie) a = Math.min(a, (p.fin - t) / p.fonduSortie);
  return Math.max(0, Math.min(1, a));
}

// Position dans le fichier source à l'instant t du film
export const tempsSource = (p: Place, t: number) => p.element.coupeDebut + (t - p.debut);

export function visiblesA(places: Place[], t: number) {
  return places
    .filter((p) => p.element.nature !== "audio" && t >= p.debut && t < p.fin)
    .sort((a, b) => a.niveau - b.niveau || a.debut - b.debut); // du fond vers le dessus
}

const borne = (x: number) => Math.max(0, Math.min(1, x));
const lisse = (x: number) => x * x * (3 - 2 * x); // départ et arrivée en douceur

// Dessine une image (frame vidéo ou photo) en remplissant le cadre, avec le zoom lent et la transition en cours
export function dessiner(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  p: Place,
  t: number,
  largeur: number,
  hauteur: number,
) {
  if (!sw || !sh) return;
  let alpha = 1;
  let dx = 0;
  let volet = 1;
  let blanc = 0;
  let zoomEffet = 1;
  if (p.fonduEntree > 0 && t < p.debut + p.fonduEntree) {
    const q = lisse(borne((t - p.debut) / p.fonduEntree));
    if (p.entree === "glisse") dx = (1 - q) * largeur;
    else if (p.entree === "volet") volet = q;
    else if (p.entree === "blanc") blanc = 1 - q;
    else if (p.entree === "zoom") (alpha = q), (zoomEffet = 1 + 0.3 * (1 - q));
    else alpha = q;
  }
  if (p.fonduSortie > 0 && t > p.fin - p.fonduSortie) {
    const q = lisse(borne((p.fin - t) / p.fonduSortie));
    if (p.sortie === "blanc") blanc = Math.max(blanc, 1 - q);
    else alpha = Math.min(alpha, q);
  }
  if (p.pousse > 0 && t > p.fin - p.pousse) dx = -lisse(borne((t - (p.fin - p.pousse)) / p.pousse)) * largeur;
  if (alpha <= 0 || volet <= 0) return;

  const progres = borne((t - p.debut) / Math.max(0.01, p.fin - p.debut));
  const z = (p.element.zoom === "avant" ? 1 + 0.12 * progres : p.element.zoom === "arriere" ? 1.12 - 0.12 * progres : 1) * zoomEffet;
  const echelle = Math.max(largeur / sw, hauteur / sh) * z;
  const w = sw * echelle;
  const h = sh * echelle;
  ctx.save();
  if (volet < 1) {
    ctx.beginPath();
    ctx.rect(0, 0, largeur * volet, hauteur);
    ctx.clip();
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(source, (largeur - w) / 2 + dx, (hauteur - h) / 2, w, h);
  if (blanc > 0) {
    ctx.globalAlpha = blanc;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, largeur, hauteur);
  }
  ctx.restore();
}

// Programme tous les sons (voix off, musique, son des vidéos importées) dans un contexte Web Audio.
// Sert à l'aperçu (AudioContext, à partir de « depuis ») et à l'export (OfflineAudioContext, depuis 0).
export function programmerSons(
  ctx: BaseAudioContext,
  places: Place[],
  sons: Map<string, AudioBuffer>,
  depuis: number,
  zero: number, // ctx.currentTime qui correspond à « depuis »
) {
  const lances: AudioBufferSourceNode[] = [];
  for (const p of places) {
    const buffer = sons.get(p.element.chemin);
    if (!buffer || p.piste.muet || p.fin <= depuis) continue;
    const niveau = p.piste.volume * p.element.volume;
    if (niveau <= 0) continue;
    const debutLocal = Math.max(depuis, p.debut);
    const offset = tempsSource(p, debutLocal);
    if (offset >= buffer.duration) continue;
    const quand = zero + (debutLocal - depuis);
    const duree = Math.min(p.fin - debutLocal, buffer.duration - offset);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    // Enveloppe : points de passage des fondus, en temps du contexte
    const aT = (t: number) => zero + (t - depuis);
    gain.gain.setValueAtTime(niveau * enveloppe(p, debutLocal), quand);
    const points = [p.debut + p.fonduEntree, p.fin - p.fonduSortie, p.fin].filter((x) => x > debutLocal);
    for (const x of points) gain.gain.linearRampToValueAtTime(niveau * enveloppe(p, Math.min(x, p.fin - 1e-3)), aT(x));
    src.connect(gain).connect(ctx.destination);
    src.start(quand, offset, duree);
    lances.push(src);
  }
  return lances;
}

export function formatTemps(s: number) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}
