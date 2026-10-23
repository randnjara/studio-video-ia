"use client";

import { useRef, useState } from "react";
import { DUREE_MIN, type Place, type Timeline } from "@/lib/montage";
import { type Selection, ajouterPiste, deplacerDansPiste, majElement, majPisteInfos, supprimerPiste } from "./edition";

// Les pistes, comme dans un logiciel de montage : on glisse un bloc pour le déplacer (ou changer l'ordre sur la piste
// principale), on tire ses bords pour raccourcir, on clique sur la règle pour placer le curseur.

const ENTETE = 168;
const HAUTEUR = { video: 56, audio: 44 };

type Geste = {
  mode: "deplacer" | "gauche" | "droite";
  piste: string;
  element: string;
  x0: number;
  debut0: number;
  coupe0: number;
  longueur0: number;
  bouge: boolean;
};

export function Pistes({
  timeline,
  places,
  duree,
  temps,
  selection,
  pisteActive,
  modifiable,
  liens,
  modifier,
  debutGeste,
  onSelection,
  onPisteActive,
  onTemps,
}: {
  timeline: Timeline;
  places: Place[];
  duree: number;
  temps: number;
  selection: Selection;
  pisteActive: string | null;
  modifiable: boolean;
  liens: Map<string, string>;
  modifier: (fn: (t: Timeline) => Timeline, historique?: boolean) => void;
  debutGeste: () => void;
  onSelection: (s: Selection) => void;
  onPisteActive: (id: string) => void;
  onTemps: (t: number) => void;
}) {
  const [zoom, setZoom] = useState(40); // pixels par seconde
  const geste = useRef<Geste | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const largeur = Math.max(duree + 15, 30) * zoom;

  const tempsDepuisX = (clientX: number) => {
    const r = zone.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - ENTETE + zone.current!.scrollLeft) / zoom);
  };

  // Aimant : les bords se collent au curseur, au début et aux autres blocs
  const aimanter = (t: number, ignorer: string) => {
    const reperes = [0, temps, ...places.filter((p) => p.element.id !== ignorer).flatMap((p) => [p.debut, p.fin])];
    let meilleur = t;
    let ecart = 8 / zoom;
    for (const r of reperes) if (Math.abs(r - t) < ecart) (meilleur = r), (ecart = Math.abs(r - t));
    return meilleur;
  };

  const commencer = (e: React.PointerEvent, mode: Geste["mode"], p: Place) => {
    e.stopPropagation();
    onSelection({ piste: p.piste.id, element: p.element.id });
    if (!modifiable) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    geste.current = {
      mode,
      piste: p.piste.id,
      element: p.element.id,
      x0: e.clientX,
      debut0: p.debut,
      coupe0: p.element.coupeDebut,
      longueur0: p.element.longueur,
      bouge: false,
    };
  };

  const bouger = (e: React.PointerEvent) => {
    const g = geste.current;
    if (!g) return;
    const dx = (e.clientX - g.x0) / zoom;
    if (!g.bouge) {
      if (Math.abs(e.clientX - g.x0) < 4) return;
      g.bouge = true;
      debutGeste();
    }
    modifier((t) => {
      const piste = t.pistes.find((p) => p.id === g.piste);
      const el = piste?.elements.find((x) => x.id === g.element);
      if (!piste || !el) return t;
      const principale = piste === t.pistes[0];
      const max = el.nature === "image" ? 600 : Math.max(DUREE_MIN, (el.duree ?? 600) - g.coupe0);

      if (g.mode === "deplacer") {
        if (principale) {
          // Nouvel ordre : on compte les plans dont le milieu est avant le pointeur
          const x = tempsDepuisX(e.clientX);
          const autres = places.filter((p) => p.principale && p.element.id !== g.element);
          const index = autres.filter((p) => (p.debut + p.fin) / 2 < x).length;
          const actuel = piste.elements.findIndex((x) => x.id === g.element);
          return index === actuel ? t : deplacerDansPiste(t, piste.id, g.element, index);
        }
        const debut = Math.max(0, aimanter(g.debut0 + dx, g.element));
        const fin = aimanter(debut + el.longueur, g.element);
        return majElement(t, piste.id, g.element, { debut: Math.max(0, fin !== debut + el.longueur ? fin - el.longueur : debut) });
      }
      if (g.mode === "droite") {
        const fin = aimanter(g.debut0 + g.longueur0 + dx, g.element);
        return majElement(t, piste.id, g.element, { longueur: Math.max(DUREE_MIN, Math.min(max, fin - g.debut0)) });
      }
      // Bord gauche : on enlève (ou on rend) le début du plan
      let d = aimanter(g.debut0 + dx, g.element) - g.debut0;
      d = Math.min(d, g.longueur0 - DUREE_MIN);
      if (el.nature !== "image") d = Math.max(d, -g.coupe0);
      if (!principale) d = Math.max(d, -g.debut0);
      if (principale && el.nature === "image") d = Math.max(d, -600);
      return majElement(t, piste.id, g.element, {
        longueur: g.longueur0 - d,
        coupeDebut: el.nature === "image" ? 0 : g.coupe0 + d,
        ...(principale ? {} : { debut: g.debut0 + d }),
      });
    }, false);
  };

  const finir = () => {
    const g = geste.current;
    geste.current = null;
    if (g?.bouge && g.mode === "deplacer") {
      // Les pistes libres restent triées dans le temps
      modifier(
        (t) => ({
          ...t,
          pistes: t.pistes.map((p, i) => (i === 0 ? p : { ...p, elements: [...p.elements].sort((a, b) => a.debut - b.debut) })),
        }),
        false,
      );
    }
  };

  const graduation = zoom >= 60 ? 1 : zoom >= 25 ? 2 : zoom >= 12 ? 5 : 10;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <b>Pistes</b>
        {modifiable && (
          <>
            <button type="button" className="bouton-discret px-3 py-1 text-xs" onClick={() => modifier((t) => ajouterPiste(t, "video"))}>
              + Piste vidéo / image
            </button>
            <button type="button" className="bouton-discret px-3 py-1 text-xs" onClick={() => modifier((t) => ajouterPiste(t, "audio"))}>
              + Piste audio
            </button>
          </>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-sourdine">
          Zoom
          <input type="range" min={6} max={160} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-[var(--accent)]" />
        </label>
      </div>

      <div
        ref={zone}
        className="relative overflow-x-auto rounded-lg border border-ligne bg-surface-2 select-none"
        onPointerMove={bouger}
        onPointerUp={finir}
        onPointerCancel={finir}
      >
        <div style={{ width: largeur + ENTETE }} className="relative">
          {/* Règle */}
          <div
            className="sticky top-0 z-20 flex h-6 cursor-pointer border-b border-ligne bg-surface"
            onPointerDown={(e) => {
              onTemps(tempsDepuisX(e.clientX));
              const suivre = (ev: PointerEvent) => onTemps(tempsDepuisX(ev.clientX));
              const stop = () => (window.removeEventListener("pointermove", suivre), window.removeEventListener("pointerup", stop));
              window.addEventListener("pointermove", suivre);
              window.addEventListener("pointerup", stop);
            }}
          >
            <div className="sticky left-0 z-10 shrink-0 border-r border-ligne bg-surface" style={{ width: ENTETE }} />
            <div className="relative flex-1">
              {Array.from({ length: Math.ceil(largeur / zoom / graduation) + 1 }, (_, i) => i * graduation).map((s) => (
                <span key={s} className="absolute top-0 h-full border-l border-ligne pl-1 text-[10px] text-sourdine" style={{ left: s * zoom }}>
                  {s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`}
                </span>
              ))}
            </div>
          </div>

          {timeline.pistes.map((piste, niveau) => {
            const h = HAUTEUR[piste.nature];
            const active = pisteActive === piste.id;
            return (
              <div key={piste.id} className="flex border-b border-ligne" style={{ height: h }}>
                {/* En-tête de piste */}
                <div
                  className={`sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r border-ligne px-2 text-xs ${active ? "bg-accent-doux" : "bg-surface"}`}
                  style={{ width: ENTETE }}
                  onClick={() => onPisteActive(piste.id)}
                >
                  <div className="flex items-center gap-1">
                    <span>{piste.nature === "audio" ? "🔊" : niveau === 0 ? "🎬" : "🖼"}</span>
                    <input
                      value={piste.nom}
                      disabled={!modifiable}
                      onChange={(e) => modifier((t) => majPisteInfos(t, piste.id, { nom: e.target.value }), false)}
                      className="min-w-0 flex-1 truncate bg-transparent font-semibold outline-none"
                      aria-label="Nom de la piste"
                    />
                    <button
                      type="button"
                      title={piste.muet ? "Remettre le son" : "Couper le son de la piste"}
                      className={piste.muet ? "text-alerte" : "text-sourdine"}
                      onClick={(e) => (e.stopPropagation(), modifier((t) => majPisteInfos(t, piste.id, { muet: !piste.muet })))}
                    >
                      {piste.muet ? "🔇" : "🔈"}
                    </button>
                    {modifiable && niveau > 0 && (
                      <button
                        type="button"
                        title="Supprimer la piste"
                        className="text-sourdine hover:text-alerte"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (piste.elements.length === 0 || window.confirm(`Supprimer la piste « ${piste.nom} » et son contenu ?`))
                            modifier((t) => supprimerPiste(t, piste.id));
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {piste.nature === "audio" && (
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={piste.volume}
                      disabled={!modifiable}
                      onChange={(e) => modifier((t) => majPisteInfos(t, piste.id, { volume: Number(e.target.value) }), false)}
                      title={`Volume de la piste : ${Math.round(piste.volume * 100)} %`}
                      className="h-3 w-full accent-[var(--accent)]"
                    />
                  )}
                  {piste.nature === "video" && (
                    <span className="text-[10px] text-sourdine">{niveau === 0 ? "Plans bout à bout" : "Par-dessus la principale"}</span>
                  )}
                </div>

                {/* Blocs */}
                <div className="relative flex-1" onPointerDown={() => (onPisteActive(piste.id), onSelection(null))}>
                  {places
                    .filter((p) => p.piste.id === piste.id)
                    .map((p) => {
                      const e = p.element;
                      const choisi = selection?.element === e.id;
                      const couleur =
                        e.nature === "audio"
                          ? "bg-emerald-600/80 border-emerald-700"
                          : e.nature === "image"
                            ? "bg-amber-500/80 border-amber-600"
                            : "bg-indigo-500/80 border-indigo-600";
                      const fond = e.nature === "image" ? liens.get(e.chemin) : undefined;
                      return (
                        <div
                          key={e.id}
                          className={`absolute top-1 bottom-1 overflow-hidden rounded-md border text-[11px] text-white ${couleur} ${choisi ? "ring-2 ring-offset-1 ring-[var(--encre)]" : ""} ${modifiable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                          style={{
                            left: p.debut * zoom,
                            width: Math.max(4, (p.fin - p.debut) * zoom),
                            backgroundImage: fond ? `linear-gradient(rgb(0 0 0 / 0.35), rgb(0 0 0 / 0.35)), url("${fond}")` : undefined,
                            backgroundSize: "auto 100%",
                            zIndex: choisi ? 3 : 1,
                          }}
                          onPointerDown={(ev) => commencer(ev, "deplacer", p)}
                          title={`${e.nom} · ${e.longueur.toFixed(1)} s`}
                        >
                          {p.fonduEntree > 0 && (
                            <span
                              className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/60 to-transparent"
                              style={{ width: p.fonduEntree * zoom }}
                            />
                          )}
                          {p.fonduSortie > 0 && (
                            <span
                              className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/60 to-transparent"
                              style={{ width: p.fonduSortie * zoom }}
                            />
                          )}
                          <span className="pointer-events-none relative block truncate px-2 pt-1 font-semibold">
                            {e.entree !== "coupe" ? (e.entree === "noir" ? "◐ " : "⧉ ") : ""}
                            {e.zoom !== "aucun" ? "🔍 " : ""}
                            {e.nom}
                          </span>
                          {(p.element.nature === "audio" || (piste.nature === "audio" && e.volume !== 1)) && (
                            <span className="pointer-events-none relative block px-2 text-[10px] opacity-80">{Math.round(e.volume * 100)} %</span>
                          )}
                          {modifiable && (
                            <>
                              <span
                                className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                                onPointerDown={(ev) => commencer(ev, "gauche", p)}
                                title="Tirer pour raccourcir le début"
                              />
                              <span
                                className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40"
                                onPointerDown={(ev) => commencer(ev, "droite", p)}
                                title="Tirer pour raccourcir la fin"
                              />
                            </>
                          )}
                        </div>
                      );
                    })}
                  {piste.elements.length === 0 && (
                    <span className="pointer-events-none absolute inset-0 flex items-center px-3 text-xs text-sourdine">
                      {piste.nature === "audio"
                        ? "Cliquez ici puis ajoutez un son depuis « Médias » (il se pose au curseur)."
                        : "Cliquez ici puis ajoutez une image ou une vidéo depuis « Médias »."}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Curseur de lecture */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-alerte" style={{ left: ENTETE + temps * zoom }} />
        </div>
      </div>
      <p className="text-xs text-sourdine">
        Glissez un bloc pour le déplacer (sur la piste principale : pour changer l'ordre). Tirez ses bords pour raccourcir. ⧉ = fondu
        enchaîné, ◐ = fondu au noir, 🔍 = zoom lent.
      </p>
    </div>
  );
}
