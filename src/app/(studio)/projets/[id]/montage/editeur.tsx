"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Media, type Timeline, dessiner, formatTemps, placer, programmerSons, tempsSource, visiblesA } from "@/lib/montage";
import { enregistrerTimeline } from "./actions";
import { Bibliotheque } from "./bibliotheque";
import { type Selection, ajouter, corrigerDurees, couper, dupliquer, supprimer, trouver } from "./edition";
import { Exporter } from "./exporter";
import { Pistes } from "./pistes";
import { chargerSons } from "./rendu";
import { Reglages } from "./reglages";

// Le banc de montage : aperçu, médias, réglages, pistes et export.
// L'aperçu dessine sur un canvas exactement comme l'export, et le son passe par Web Audio (mêmes volumes, mêmes fondus).

const APERCU: Record<string, [number, number]> = { "9:16": [360, 640], "16:9": [640, 360], "1:1": [480, 480] };

type Props = {
  projectId: string;
  montageId: string;
  titre: string;
  format: string;
  modifiable: boolean;
  initiale: Timeline;
  clips: Media[];
  photos: Media[];
  liensInitiaux: Record<string, string>;
};

export function Editeur({ projectId, montageId, titre, format, modifiable, initiale, clips, photos, liensInitiaux }: Props) {
  const [timeline, setTimeline] = useState(initiale);
  const passe = useRef<Timeline[]>([]);
  const futur = useRef<Timeline[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [pisteActive, setPisteActive] = useState<string | null>(null);
  const [temps, setTemps] = useState(0);
  const [lecture, setLecture] = useState(false);
  const [liens, setLiens] = useState(() => new Map(Object.entries(liensInitiaux)));
  const [sauvegarde, setSauvegarde] = useState<{ etat: "ok" | "attente" | "envoi" | "erreur"; message?: string }>({ etat: "ok" });
  const [onglet, setOnglet] = useState<"medias" | "reglages">("medias");

  const { places, duree } = useMemo(() => placer(timeline), [timeline]);

  // Toute modification passe par ici : elle peut être annulée
  const modifier = useCallback((fn: (t: Timeline) => Timeline, historique = true) => {
    setTimeline((t) => {
      const n = fn(t);
      if (n !== t && historique) {
        passe.current = [...passe.current.slice(-49), t];
        futur.current = [];
      }
      return n;
    });
  }, []);
  const debutGeste = useCallback(() => {
    passe.current = [...passe.current.slice(-49), timeline];
    futur.current = [];
  }, [timeline]);
  const annuler = () => {
    const t = passe.current.pop();
    if (t) (futur.current.push(timeline), setTimeline(t));
  };
  const retablir = () => {
    const t = futur.current.pop();
    if (t) (passe.current.push(timeline), setTimeline(t));
  };

  // Enregistrement automatique, 1,5 s après la dernière modification
  const premier = useRef(true);
  useEffect(() => {
    if (premier.current) {
      premier.current = false;
      return;
    }
    if (!modifiable) return;
    setSauvegarde({ etat: "attente" });
    const minuteur = setTimeout(async () => {
      setSauvegarde({ etat: "envoi" });
      try {
        const r = await enregistrerTimeline(projectId, montageId, timeline);
        setSauvegarde(r.erreur ? { etat: "erreur", message: r.erreur } : { etat: "ok" });
      } catch {
        setSauvegarde({ etat: "erreur", message: "Connexion perdue, nouvel essai à la prochaine modification." });
      }
    }, 1500);
    return () => clearTimeout(minuteur);
  }, [timeline, modifiable, projectId, montageId]);

  // Prévient avant de quitter la page si un enregistrement est en attente
  useEffect(() => {
    const avant = (e: BeforeUnloadEvent) => {
      if (sauvegarde.etat === "attente" || sauvegarde.etat === "envoi") e.preventDefault();
    };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, [sauvegarde.etat]);

  // Liens d'accès aux fichiers privés : valables 1 h, renouvelés toutes les 45 min et pour chaque nouveau fichier
  const signer = useCallback(async (chemins: string[]) => {
    if (chemins.length === 0) return;
    const { data } = await createClient().storage.from("medias").createSignedUrls(chemins, 60 * 60 * 3);
    setLiens((l) => {
      const n = new Map(l);
      for (const s of data ?? []) if (s.path && s.signedUrl) n.set(s.path, s.signedUrl);
      return n;
    });
  }, []);
  const tousLesChemins = useMemo(
    () => [
      ...new Set([
        ...clips.map((c) => c.chemin),
        ...photos.map((p) => p.chemin),
        ...timeline.bibliotheque.map((m) => m.chemin),
        ...timeline.pistes.flatMap((p) => p.elements.map((e) => e.chemin)),
      ]),
    ],
    [clips, photos, timeline],
  );
  const cheminsRef = useRef(tousLesChemins);
  cheminsRef.current = tousLesChemins;
  useEffect(() => {
    const manquants = tousLesChemins.filter((c) => !liens.has(c));
    if (manquants.length) void signer(manquants);
  }, [tousLesChemins, liens, signer]);
  useEffect(() => {
    const id = setInterval(() => void signer(cheminsRef.current), 45 * 60 * 1000);
    return () => clearInterval(id);
  }, [signer]);

  // Durées réelles des vidéos et des sons (le tableau des plans donne une durée prévue, pas toujours exacte)
  const [durees, setDurees] = useState(new Map<string, number>());
  const mesures = useRef(new Set<string>());
  useEffect(() => {
    const aMesurer = [...clips, ...timeline.bibliotheque, ...timeline.pistes.flatMap((p) => p.elements)].filter(
      (m) => m.nature !== "image" && !mesures.current.has(m.chemin) && liens.has(m.chemin),
    );
    for (const m of aMesurer) {
      mesures.current.add(m.chemin);
      const el = document.createElement(m.nature === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) setDurees((d) => new Map(d).set(m.chemin, el.duration));
        el.removeAttribute("src");
      };
      el.src = liens.get(m.chemin)!;
    }
  }, [clips, timeline, liens]);
  useEffect(() => {
    if (durees.size) modifier((t) => corrigerDurees(t, durees), false);
  }, [durees, modifier]);
  const clipsMesures = useMemo(() => clips.map((c) => ({ ...c, duree: durees.get(c.chemin) ?? c.duree })), [clips, durees]);

  // ——— Aperçu ———
  const canvas = useRef<HTMLCanvasElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const images = useRef(new Map<string, HTMLImageElement>());
  const audio = useRef<AudioContext | null>(null);
  const lances = useRef<AudioBufferSourceNode[]>([]);
  const horloge = useRef({ t0: 0, c0: 0 });
  const tempsRef = useRef(0);
  const lectureRef = useRef(false);
  const etat = useRef({ places, duree, liens });
  etat.current = { places, duree, liens };
  const [sons, setSons] = useState(new Map<string, AudioBuffer>());
  const [sonsEnChargement, setSonsEnChargement] = useState(false);

  useEffect(() => {
    let annule = false;
    setSonsEnChargement(true);
    chargerSons(places, liens).then((s) => {
      if (!annule) (setSons(s), setSonsEnChargement(false));
    });
    return () => {
      annule = true;
    };
  }, [places, liens]);

  const arreterSons = () => {
    for (const s of lances.current) {
      try {
        s.stop();
      } catch {}
    }
    lances.current = [];
  };

  const pause = useCallback(() => {
    lectureRef.current = false;
    setLecture(false);
    arreterSons();
  }, []);

  const lire = useCallback(async () => {
    audio.current ??= new AudioContext();
    await audio.current.resume();
    let t = tempsRef.current;
    if (t >= etat.current.duree - 0.05) t = 0;
    const zero = audio.current.currentTime + 0.08;
    arreterSons();
    lances.current = programmerSons(audio.current, etat.current.places, sons, t, zero);
    horloge.current = { t0: t, c0: zero };
    tempsRef.current = t;
    lectureRef.current = true;
    setLecture(true);
  }, [sons]);

  const allerA = useCallback(
    (t: number) => {
      const relancer = lectureRef.current;
      if (relancer) pause();
      tempsRef.current = Math.max(0, Math.min(t, etat.current.duree));
      setTemps(tempsRef.current);
      if (relancer) void lire();
    },
    [pause, lire],
  );

  // Une modification pendant la lecture : on relance le son avec le nouveau montage
  useEffect(() => {
    if (lectureRef.current) void lire();
  }, [places, sons]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let raf = 0;
    const [L, H] = APERCU[format] ?? APERCU["9:16"];
    const boucle = () => {
      raf = requestAnimationFrame(boucle);
      const { places, duree, liens } = etat.current;
      let t = tempsRef.current;
      if (lectureRef.current && audio.current) {
        t = horloge.current.t0 + Math.max(0, audio.current.currentTime - horloge.current.c0);
        if (t >= duree) {
          t = duree;
          lectureRef.current = false;
          setLecture(false);
          arreterSons();
        }
        tempsRef.current = t;
        setTemps(t);
      }

      // Les vidéos proches du curseur sont préparées, les autres libérées
      const garder = new Set<string>();
      for (const p of places) {
        if (p.element.nature !== "video" || t < p.debut - 1.5 || t > p.fin + 0.5) continue;
        const url = liens.get(p.element.chemin);
        if (!url) continue;
        garder.add(p.element.id);
        let v = videos.current.get(p.element.id);
        if (!v) {
          v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.preload = "auto";
          v.crossOrigin = "anonymous";
          v.src = url;
          videos.current.set(p.element.id, v);
        }
        const voulu = Math.min(tempsSource(p, Math.max(t, p.debut)), (p.element.duree ?? Infinity) - 0.05);
        const dedans = t >= p.debut && t < p.fin;
        if (lectureRef.current && dedans) {
          if (v.paused) {
            v.currentTime = voulu;
            void v.play().catch(() => {});
          } else if (Math.abs(v.currentTime - voulu) > 0.3) v.currentTime = voulu;
        } else {
          if (!v.paused) v.pause();
          if (!v.seeking && Math.abs(v.currentTime - voulu) > 0.04) v.currentTime = voulu;
        }
      }
      for (const [id, v] of videos.current) {
        if (!garder.has(id)) {
          v.pause();
          v.removeAttribute("src");
          v.load();
          videos.current.delete(id);
        }
      }

      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, L, H);
      for (const p of visiblesA(places, t)) {
        if (p.element.nature === "image") {
          let img = images.current.get(p.element.chemin);
          const url = liens.get(p.element.chemin);
          if (!img && url) {
            img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            images.current.set(p.element.chemin, img);
          }
          if (img?.complete && img.naturalWidth) dessiner(ctx, img, img.naturalWidth, img.naturalHeight, p, t, L, H);
        } else {
          const v = videos.current.get(p.element.id);
          if (v && v.readyState >= 2) dessiner(ctx, v, v.videoWidth, v.videoHeight, p, t, L, H);
        }
      }
    };
    boucle();
    const pool = videos.current;
    return () => {
      cancelAnimationFrame(raf);
      for (const v of pool.values()) (v.pause(), v.removeAttribute("src"));
      pool.clear();
    };
  }, [format]);

  useEffect(() => () => void audio.current?.close(), []);

  // ——— Actions ———
  const selectionner = (s: Selection) => {
    setSelection(s);
    if (s) {
      setPisteActive(s.piste);
      setOnglet("reglages");
    }
  };
  const ajouterMedia = (m: Media) => {
    if (!modifiable) return;
    let sel: Selection = null;
    modifier((t) => {
      const r = ajouter(t, m, tempsRef.current, pisteActive ?? undefined);
      sel = r.selection;
      return r.timeline;
    });
    setTimeout(() => sel && setSelection(sel));
  };
  const couperIci = () => {
    let sel: Selection = selection;
    modifier((t) => {
      // Sans sélection : on coupe le plan de la piste principale qui est sous le curseur
      let s = selection;
      if (!s) {
        const p = placer(t).places.find((x) => x.principale && tempsRef.current > x.debut && tempsRef.current < x.fin);
        if (p) s = { piste: p.piste.id, element: p.element.id };
      }
      const r = couper(t, s, tempsRef.current);
      sel = r.selection;
      return r.timeline;
    });
    setTimeout(() => setSelection(sel));
  };
  const supprimerSelection = () => {
    modifier((t) => supprimer(t, selection));
    setSelection(null);
  };
  const dupliquerSelection = () => {
    let sel: Selection = selection;
    modifier((t) => {
      const r = dupliquer(t, selection);
      sel = r.selection;
      return r.timeline;
    });
    setTimeout(() => setSelection(sel));
  };

  // Raccourcis : espace = lecture, Suppr = supprimer, Ctrl+Z / Ctrl+Y = annuler / rétablir
  const raccourcis = useRef<(e: KeyboardEvent) => void>(() => {});
  raccourcis.current = (e: KeyboardEvent) => {
    const cible = e.target as HTMLElement;
    if (cible.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === " ") {
      e.preventDefault();
      if (lectureRef.current) pause();
      else void lire();
    } else if (!modifiable) return;
    else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
      e.preventDefault();
      supprimerSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) retablir();
      else annuler();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      retablir();
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => raccourcis.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const { piste: pisteSel, element: elementSel } = trouver(timeline, selection);
  const placeSel = places.find((p) => p.element.id === selection?.element);
  const [L, H] = APERCU[format] ?? APERCU["9:16"];
  const sonsManquants = places.some((p) => (p.element.nature === "audio" || (p.element.nature === "video" && !p.element.takeId)) && !sons.has(p.element.chemin));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Aperçu */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex justify-center rounded-lg bg-black p-2">
            <canvas
              ref={canvas}
              width={L}
              height={H}
              className="max-h-[60vh] w-auto max-w-full"
              style={{ aspectRatio: `${L} / ${H}` }}
              onClick={() => (lectureRef.current ? pause() : void lire())}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="bouton px-3 py-1" onClick={() => (lecture ? pause() : void lire())}>
              {lecture ? "⏸ Pause" : "▶ Lire"}
            </button>
            <button type="button" className="bouton-discret px-3 py-1" onClick={() => allerA(0)} title="Revenir au début">
              ⏮
            </button>
            <span className="font-mono tabular-nums">
              {formatTemps(temps)} / {formatTemps(duree)}
            </span>
            {sonsEnChargement && sonsManquants && <span className="text-xs text-sourdine">Chargement du son…</span>}
            {modifiable && (
              <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" className="bouton-discret px-3 py-1" onClick={couperIci} title="Coupe le plan en deux à l'endroit du curseur">
                  ✂ Couper au curseur
                </button>
                <button type="button" className="bouton-discret px-3 py-1" onClick={annuler} disabled={passe.current.length === 0} title="Annuler (Ctrl+Z)">
                  ↶
                </button>
                <button type="button" className="bouton-discret px-3 py-1" onClick={retablir} disabled={futur.current.length === 0} title="Rétablir (Ctrl+Y)">
                  ↷
                </button>
              </span>
            )}
          </div>
          <p className="text-xs text-sourdine">
            {modifiable ? (
              <>
                {sauvegarde.etat === "ok" && "✓ Enregistré automatiquement."}
                {sauvegarde.etat === "attente" && "Modifications en attente d'enregistrement…"}
                {sauvegarde.etat === "envoi" && "Enregistrement…"}
                {sauvegarde.etat === "erreur" && <span className="text-alerte">{sauvegarde.message}</span>} Espace = lecture,
                Suppr = supprimer, Ctrl+Z = annuler.
              </>
            ) : (
              "Montage verrouillé pendant la validation : rouvrez-le pour le modifier. L'aperçu et le téléchargement restent possibles."
            )}
          </p>
        </div>

        {/* Médias et réglages */}
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-ligne p-3">
          <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
            {(["medias", "reglages"] as const).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOnglet(o)}
                className={`flex-1 rounded-md px-3 py-1 font-semibold ${onglet === o ? "bg-surface shadow-sm" : "text-sourdine"}`}
              >
                {o === "medias" ? "Médias" : "Réglages"}
              </button>
            ))}
          </div>
          {onglet === "medias" ? (
            <Bibliotheque
              projectId={projectId}
              clips={clipsMesures}
              photos={photos}
              fichiers={timeline.bibliotheque}
              liens={liens}
              modifiable={modifiable}
              onAjouter={ajouterMedia}
              onImporte={(m) => {
                modifier((t) => ({ ...t, bibliotheque: [...t.bibliotheque, m] }));
                void signer([m.chemin]);
              }}
            />
          ) : (
            <Reglages
              timeline={timeline}
              piste={pisteSel}
              element={elementSel}
              place={placeSel}
              modifiable={modifiable}
              aSon={Boolean(elementSel && sons.has(elementSel.chemin))}
              modifier={modifier}
              onCouper={couperIci}
              onDupliquer={dupliquerSelection}
              onSupprimer={supprimerSelection}
            />
          )}
        </div>
      </div>

      <Pistes
        timeline={timeline}
        places={places}
        duree={duree}
        temps={temps}
        selection={selection}
        pisteActive={pisteActive}
        modifiable={modifiable}
        liens={liens}
        modifier={modifier}
        debutGeste={debutGeste}
        onSelection={selectionner}
        onPisteActive={setPisteActive}
        onTemps={allerA}
      />

      <Exporter timeline={timeline} liens={liens} format={format} titre={titre} />
    </div>
  );
}
