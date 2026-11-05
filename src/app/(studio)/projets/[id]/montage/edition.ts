import { DUREE_MIN, type Element, type Media, type Piste, type Timeline, nouvelElement, nouvelId, nouvellePiste, placer } from "@/lib/montage";

// Opérations de montage : chacune prend une timeline et en renvoie une nouvelle (ce qui permet « Annuler »).

export type Selection = { piste: string; element: string } | null;

export const trouver = (t: Timeline, s: Selection) => {
  const piste = t.pistes.find((p) => p.id === s?.piste);
  const element = piste?.elements.find((e) => e.id === s?.element);
  return { piste, element };
};

function majPiste(t: Timeline, pisteId: string, fn: (p: Piste) => Piste): Timeline {
  return { ...t, pistes: t.pistes.map((p) => (p.id === pisteId ? fn(p) : p)) };
}

export function majElement(t: Timeline, pisteId: string, elementId: string, patch: Partial<Element>): Timeline {
  return majPiste(t, pisteId, (p) => ({ ...p, elements: p.elements.map((e) => (e.id === elementId ? { ...e, ...patch } : e)) }));
}

export function majPisteInfos(t: Timeline, pisteId: string, patch: Partial<Omit<Piste, "elements">>): Timeline {
  return majPiste(t, pisteId, (p) => ({ ...p, ...patch }));
}

export function supprimer(t: Timeline, s: Selection): Timeline {
  if (!s) return t;
  return majPiste(t, s.piste, (p) => ({ ...p, elements: p.elements.filter((e) => e.id !== s.element) }));
}

export function deplacerDansPiste(t: Timeline, pisteId: string, elementId: string, index: number): Timeline {
  return majPiste(t, pisteId, (p) => {
    const de = p.elements.findIndex((e) => e.id === elementId);
    if (de < 0) return p;
    const els = [...p.elements];
    const [e] = els.splice(de, 1);
    els.splice(Math.max(0, Math.min(els.length, index)), 0, e);
    return { ...p, elements: els };
  });
}

// Fin du dernier élément d'une piste libre
const finPiste = (p: Piste) => p.elements.reduce((m, e) => Math.max(m, e.debut + e.longueur), 0);

// Une piste libre (images par-dessus, sons) : l'élément se pose au curseur, ou après le dernier s'il y a déjà quelque chose
function positionLibre(p: Piste, temps: number, longueur: number) {
  const chevauche = p.elements.some((e) => temps < e.debut + e.longueur && temps + longueur > e.debut);
  return chevauche ? finPiste(p) : temps;
}

export function ajouter(t: Timeline, media: Media, temps: number, pisteVoulue?: string): { timeline: Timeline; selection: Selection } {
  const nature = media.nature === "audio" ? "audio" : "video";
  let pistes = t.pistes;
  let cible = pistes.find((p, i) => p.id === pisteVoulue && p.nature === nature && (nature === "audio" || i > 0));
  if (!cible && nature === "video") cible = pistes[0];
  if (!cible) {
    cible = pistes.find((p) => p.nature === "audio");
    if (!cible) {
      cible = nouvellePiste("audio", "Son");
      pistes = [...pistes, cible];
    }
  }
  const e = nouvelElement(media);
  if (cible !== pistes[0]) e.debut = positionLibre(cible, temps, e.longueur);
  const id = cible.id;
  const timeline = { ...t, pistes: pistes.map((p) => (p.id === id ? { ...p, elements: [...p.elements, e] } : p)) };
  if (id !== t.pistes[0].id) timeline.pistes = timeline.pistes.map((p) => (p.id === id ? { ...p, elements: trier(p.elements) } : p));
  return { timeline, selection: { piste: id, element: e.id } };
}

const trier = (els: Element[]) => [...els].sort((a, b) => a.debut - b.debut);

// Coupe l'élément en deux au curseur
export function couper(t: Timeline, s: Selection, temps: number): { timeline: Timeline; selection: Selection } {
  const place = placer(t).places.find((p) => p.piste.id === s?.piste && p.element.id === s?.element);
  if (!place || temps <= place.debut + DUREE_MIN || temps >= place.fin - DUREE_MIN) return { timeline: t, selection: s };
  const e = place.element;
  const avant = temps - place.debut;
  const premier: Element = { ...e, longueur: avant, sortie: "coupe" };
  const second: Element = {
    ...e,
    id: nouvelId(),
    debut: e.debut + avant,
    coupeDebut: e.nature === "image" ? 0 : e.coupeDebut + avant,
    longueur: e.longueur - avant,
    entree: "coupe",
  };
  const timeline = majPiste(t, place.piste.id, (p) => ({
    ...p,
    elements: p.elements.flatMap((x) => (x.id === e.id ? [premier, second] : [x])),
  }));
  return { timeline, selection: { piste: place.piste.id, element: second.id } };
}

export function dupliquer(t: Timeline, s: Selection): { timeline: Timeline; selection: Selection } {
  const { piste, element } = trouver(t, s);
  if (!piste || !element) return { timeline: t, selection: s };
  const copie: Element = { ...element, id: nouvelId(), debut: piste === t.pistes[0] ? 0 : finPiste(piste) };
  const timeline = majPiste(t, piste.id, (p) => {
    const i = p.elements.findIndex((x) => x.id === element.id);
    const els = [...p.elements];
    els.splice(p === t.pistes[0] ? i + 1 : els.length, 0, copie);
    return { ...p, elements: els };
  });
  return { timeline, selection: { piste: piste.id, element: copie.id } };
}

export function ajouterPiste(t: Timeline, nature: Piste["nature"]): Timeline {
  const n = t.pistes.filter((p) => p.nature === nature).length + 1;
  const piste = nouvellePiste(nature, nature === "audio" ? `Son ${n}` : `Vidéo ${n}`);
  // Les pistes vidéo restent au-dessus des pistes audio dans la liste
  const i = nature === "video" ? t.pistes.filter((p) => p.nature === "video").length : t.pistes.length;
  const pistes = [...t.pistes];
  pistes.splice(i, 0, piste);
  return { ...t, pistes };
}

export function supprimerPiste(t: Timeline, pisteId: string): Timeline {
  if (t.pistes[0].id === pisteId) return t;
  return { ...t, pistes: t.pistes.filter((p) => p.id !== pisteId) };
}

// La vraie durée d'un fichier, mesurée dans le navigateur : on corrige les coupes qui dépasseraient
export function corrigerDurees(t: Timeline, durees: Map<string, number>): Timeline {
  let change = false;
  const pistes = t.pistes.map((p) => ({
    ...p,
    elements: p.elements.map((e) => {
      const d = durees.get(e.chemin);
      if (e.nature === "image" || !d || Math.abs((e.duree ?? 0) - d) < 0.05) return e;
      change = true;
      const coupeDebut = Math.min(e.coupeDebut, Math.max(0, d - DUREE_MIN));
      return { ...e, duree: d, coupeDebut, longueur: Math.max(DUREE_MIN, Math.min(e.longueur, d - coupeDebut)) };
    }),
  }));
  const bibliotheque = t.bibliotheque.map((m) => {
    const d = durees.get(m.chemin);
    return m.nature !== "image" && d && Math.abs((m.duree ?? 0) - d) >= 0.05 ? ((change = true), { ...m, duree: d }) : m;
  });
  return change ? { ...t, pistes, bibliotheque } : t;
}

// Lip-sync : délie un clip de la voix off (il redevient un plan bout à bout comme les autres)
export function delier(t: Timeline, s: Selection): Timeline {
  const { piste, element } = trouver(t, s);
  if (!piste || !element) return t;
  return majElement(t, piste.id, element.id, { lien: null });
}

// Lip-sync : relie un clip à sa voix off. Si la voix n'est plus sur une piste audio, elle est reposée à 0 s sur la piste
// « Voix off » (créée au besoin).
export function relier(t: Timeline, s: Selection): Timeline {
  const { piste, element } = trouver(t, s);
  if (!piste || !element?.voix) return t;
  const voix = element.voix;
  let timeline = t;
  let bloc = timeline.pistes.filter((p) => p.nature === "audio").flatMap((p) => p.elements).find((e) => e.chemin === voix.chemin);
  if (!bloc) {
    bloc = nouvelElement({ chemin: voix.chemin, nature: "audio", nom: voix.nom, duree: voix.duree });
    let cible = timeline.pistes.find((p) => p.nature === "audio" && /voix/i.test(p.nom));
    if (!cible) {
      cible = nouvellePiste("audio", "Voix off");
      timeline = { ...timeline, pistes: [...timeline.pistes, cible] };
    }
    const nouveau = bloc;
    timeline = majPiste(timeline, cible.id, (p) => ({ ...p, elements: trier([...p.elements, nouveau]) }));
  }
  return majElement(timeline, piste.id, element.id, { lien: bloc.id });
}

// Remplace le fichier d'un bloc (une autre voix, une autre musique…) en gardant sa place, ses réglages et ses liens
export function remplacer(t: Timeline, s: Selection, media: Media): Timeline {
  const { piste, element } = trouver(t, s);
  if (!piste || !element || media.nature !== element.nature) return t;
  const d = media.duree ?? element.duree;
  const coupeDebut = d ? Math.min(element.coupeDebut, Math.max(0, d - DUREE_MIN)) : element.coupeDebut;
  const longueur = d ? Math.max(DUREE_MIN, Math.min(element.longueur, d - coupeDebut)) : element.longueur;
  const timeline = majElement(t, piste.id, element.id, { chemin: media.chemin, nom: media.nom, duree: media.duree, coupeDebut, longueur });
  // Les clips lip-sync liés à ce bloc suivent le nouveau fichier
  const principale = timeline.pistes[0];
  return {
    ...timeline,
    pistes: timeline.pistes.map((p) =>
      p.id !== principale.id
        ? p
        : {
            ...p,
            elements: p.elements.map((e) =>
              e.lien === element.id && e.voix ? { ...e, voix: { ...e.voix, chemin: media.chemin, nom: media.nom, duree: media.duree } } : e,
            ),
          },
    ),
  };
}
