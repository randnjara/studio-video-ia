"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Chaine, brancher, enWav, hauteurEtVitesse, rendre } from "@/lib/table-mixage";
import { EFFETS, PRESETS, REGLAGES_DEFAUT, type Reglages, lireReglages } from "@/lib/voix";
import { enregistrerMixage } from "./actions";
import { AjoutPreset } from "./ajout-preset";

// La table de mixage : des curseurs qu'on pousse en écoutant. Le son est calculé par le navigateur (gratuit).

type Piste = {
  id: string;
  nom: string;
  url: string;
  reglages: Partial<Reglages>;
  // Voix du catalogue utilisée, pour enregistrer ces réglages comme une nouvelle voix
  voixId: string | null;
};

type Curseur = {
  cle: "hauteur" | "vitesse" | "grave" | "medium" | "aigu" | "chevrotement" | "echo" | "reverb" | "volume";
  nom: string;
  min: number;
  max: number;
  pas: number;
  lire: (v: number) => string;
};

const signe = (v: number, unite: string) => `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}${unite}`;
const pourcent = (v: number) => `${Math.round(v * 100)} %`;

const CURSEURS: Curseur[] = [
  { cle: "hauteur", nom: "Hauteur", min: -12, max: 12, pas: 0.5, lire: (v) => signe(v, " dt") },
  { cle: "vitesse", nom: "Vitesse", min: 0.5, max: 2, pas: 0.05, lire: (v) => `×${v.toFixed(2)}` },
  { cle: "grave", nom: "Grave", min: -12, max: 12, pas: 1, lire: (v) => signe(v, " dB") },
  { cle: "medium", nom: "Médium", min: -12, max: 12, pas: 1, lire: (v) => signe(v, " dB") },
  { cle: "aigu", nom: "Aigu", min: -12, max: 12, pas: 1, lire: (v) => signe(v, " dB") },
  { cle: "chevrotement", nom: "Âge (tremble)", min: 0, max: 1, pas: 0.05, lire: pourcent },
  { cle: "echo", nom: "Écho", min: 0, max: 1, pas: 0.05, lire: pourcent },
  { cle: "reverb", nom: "Réverb", min: 0, max: 1, pas: 0.05, lire: pourcent },
  { cle: "volume", nom: "Volume", min: 0, max: 2, pas: 0.05, lire: pourcent },
];

const formatTemps = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function ConsoleMixage({ projectId, piste, onEnregistre }: { projectId: string; piste: Piste; onEnregistre: () => void }) {
  const [reglages, setReglages] = useState<Reglages>(() => lireReglages(piste.reglages));
  const [son, setSon] = useState<AudioBuffer | null>(null);
  const [modifie, setModifie] = useState<AudioBuffer | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [niveau, setNiveau] = useState(0);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyseRef = useRef<AnalyserNode | null>(null);
  const chaineRef = useRef<Chaine | null>(null);
  // Temps de l'AudioContext au début de la lecture, et position de départ dans le son
  const departRef = useRef({ temps: 0, position: 0 });
  const reglagesRef = useRef(reglages);
  reglagesRef.current = reglages;

  const contexte = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const analyse = ctx.createAnalyser();
      analyse.fftSize = 1024;
      analyse.connect(ctx.destination);
      ctxRef.current = ctx;
      analyseRef.current = analyse;
    }
    return ctxRef.current;
  }, []);

  // Chargement de la voix (une fois : le lien change à chaque actualisation de la page, pas le son)
  const urlRef = useRef(piste.url);
  useEffect(() => {
    let actif = true;
    setSon(null);
    setErreur(null);
    (async () => {
      try {
        const reponse = await fetch(urlRef.current);
        if (!reponse.ok) throw new Error();
        const decode = await contexte().decodeAudioData(await reponse.arrayBuffer());
        if (actif) setSon(decode);
      } catch {
        if (actif) setErreur("Impossible de lire ce son. Rechargez la page.");
      }
    })();
    return () => {
      actif = false;
    };
  }, [piste.id, contexte]);

  // Hauteur et vitesse : recalculées un court instant après le dernier mouvement du curseur
  useEffect(() => {
    if (!son) return;
    setCalcul(true);
    const minuteur = setTimeout(() => {
      setModifie(hauteurEtVitesse(contexte(), son, reglages.hauteur, reglages.vitesse));
      setCalcul(false);
    }, 250);
    return () => clearTimeout(minuteur);
  }, [son, reglages.hauteur, reglages.vitesse, contexte]);

  const positionActuelle = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !chaineRef.current) return departRef.current.position;
    return departRef.current.position + (ctx.currentTime - departRef.current.temps);
  }, []);

  const arreter = useCallback(() => {
    chaineRef.current?.arreter();
    chaineRef.current = null;
  }, []);

  const jouer = useCallback(
    (depuis: number) => {
      const ctx = contexte();
      const analyse = analyseRef.current;
      if (!modifie || !analyse) return;
      arreter();
      void ctx.resume();
      const debut = depuis >= modifie.duration - 0.05 ? 0 : depuis;
      const chaine = brancher(ctx, modifie, reglagesRef.current, analyse, debut, ctx.currentTime);
      departRef.current = { temps: ctx.currentTime, position: debut };
      chaine.source.onended = () => {
        if (chaineRef.current === chaine) {
          chaineRef.current = null;
          setLecture(false);
          setPosition(0);
          departRef.current.position = 0;
        }
      };
      chaineRef.current = chaine;
      setLecture(true);
    },
    [modifie, contexte, arreter],
  );

  // Pendant la lecture : position, niveau du son (vumètre)
  useEffect(() => {
    if (!lecture) return;
    const mesures = new Uint8Array(1024);
    let image = 0;
    const boucle = () => {
      setPosition(positionActuelle());
      const analyse = analyseRef.current;
      if (analyse) {
        analyse.getByteTimeDomainData(mesures);
        let pic = 0;
        for (const m of mesures) pic = Math.max(pic, Math.abs(m - 128) / 128);
        setNiveau(pic);
      }
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => {
      cancelAnimationFrame(image);
      setNiveau(0);
    };
  }, [lecture, positionActuelle]);

  // Réglages en direct ; l'effet et le compresseur changent la chaîne : la lecture repart au même endroit
  const structure = `${reglages.effet}|${reglages.compresseur}`;
  const structureRef = useRef(structure);
  useEffect(() => {
    chaineRef.current?.regler(reglages);
  }, [reglages]);
  useEffect(() => {
    if (structureRef.current === structure) return;
    structureRef.current = structure;
    if (chaineRef.current) jouer(positionActuelle());
  }, [structure, jouer, positionActuelle]);
  // Nouveau son (hauteur, vitesse) : on reprend au même moment du texte
  const modifieRef = useRef<AudioBuffer | null>(null);
  useEffect(() => {
    const ancien = modifieRef.current;
    modifieRef.current = modifie;
    if (ancien && modifie && chaineRef.current) jouer((positionActuelle() * ancien.duration) / modifie.duration);
  }, [modifie, jouer, positionActuelle]);

  useEffect(
    () => () => {
      arreter();
      void ctxRef.current?.close();
    },
    [arreter],
  );

  const pause = () => {
    const p = positionActuelle();
    arreter();
    setLecture(false);
    setPosition(p);
    departRef.current.position = p;
  };

  const changer = (n: Partial<Reglages>) => setReglages((r) => ({ ...r, ...n }));

  async function calculerWav() {
    if (!son) throw new Error("Son pas encore chargé.");
    const final = await rendre(son, reglages);
    return { wav: enWav(final), duree: final.duration };
  }

  async function enregistrer() {
    setEnvoi("Calcul du son…");
    setMessage(null);
    setErreur(null);
    try {
      const { wav, duree } = await calculerWav();
      setEnvoi("Envoi…");
      const chemin = `${projectId}/voix/${piste.id}-mix-${Date.now()}.wav`;
      const { error } = await createClient().storage.from("medias").upload(chemin, wav, { contentType: "audio/wav" });
      if (error) throw new Error(error.message);
      const r = await enregistrerMixage(projectId, piste.id, { chemin, reglages, duree });
      if (r.erreur) throw new Error(r.erreur);
      setMessage("Enregistré : cette version est proposée dans le montage (Médias → Voix).");
      onEnregistre();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
    setEnvoi(null);
  }

  async function telecharger() {
    setEnvoi("Calcul du son…");
    try {
      const { wav } = await calculerWav();
      const lien = document.createElement("a");
      lien.href = URL.createObjectURL(wav);
      lien.download = `${piste.nom || "voix"}.wav`;
      lien.click();
      setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Téléchargement impossible.");
    }
    setEnvoi(null);
  }

  const duree = modifie?.duration ?? son?.duration ?? 0;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-zinc-100 shadow-inner">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs tracking-widest text-emerald-400 uppercase">Table de mixage</span>
        <b className="truncate">{piste.nom}</b>
        {calcul && son && <span className="text-xs text-amber-300">calcul…</span>}
        <span className="ml-auto font-mono text-sm text-zinc-400">
          {formatTemps(position)} / {formatTemps(duree)}
        </span>
      </div>

      {/* Transport et vumètre */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!modifie}
          onClick={() => (lecture ? pause() : jouer(position))}
          className="flex size-12 items-center justify-center rounded-full bg-emerald-500 text-xl text-zinc-900 shadow disabled:opacity-40"
          aria-label={lecture ? "Pause" : "Écouter"}
        >
          {lecture ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          disabled={!modifie}
          onClick={() => {
            arreter();
            setLecture(false);
            setPosition(0);
            departRef.current.position = 0;
          }}
          className="flex size-10 items-center justify-center rounded-full bg-zinc-700 disabled:opacity-40"
          aria-label="Revenir au début"
        >
          ⏮
        </button>
        <input
          type="range"
          min={0}
          max={duree || 1}
          step={0.01}
          value={Math.min(position, duree)}
          onChange={(e) => {
            const p = Number(e.target.value);
            setPosition(p);
            departRef.current.position = p;
            if (chaineRef.current) jouer(p);
          }}
          className="min-w-40 flex-1 accent-emerald-400"
          aria-label="Position"
        />
        <div className="flex h-3 w-28 overflow-hidden rounded bg-zinc-800" aria-hidden>
          <div
            className={`h-full transition-[width] duration-75 ${niveau > 0.95 ? "bg-red-500" : niveau > 0.7 ? "bg-amber-400" : "bg-emerald-400"}`}
            style={{ width: `${Math.min(niveau, 1) * 100}%` }}
          />
        </div>
      </div>
      {!son && !erreur && <p className="text-sm text-zinc-400">Chargement du son…</p>}

      {/* Préréglages */}
      <div className="flex flex-wrap gap-1.5">
        <BoutonConsole actif={false} onClick={() => setReglages(lireReglages(piste.reglages))}>
          ★ Réglage de la voix
        </BoutonConsole>
        {PRESETS.map((p) => (
          <BoutonConsole key={p.nom} actif={false} onClick={() => setReglages({ ...REGLAGES_DEFAUT, ...p.reglages })}>
            {p.nom}
          </BoutonConsole>
        ))}
        <BoutonConsole actif={false} onClick={() => setReglages(REGLAGES_DEFAUT)}>
          ↺ Tout à zéro
        </BoutonConsole>
      </div>

      {/* Les tranches de la table */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {CURSEURS.map((c) => {
          const valeur = reglages[c.cle];
          const neutre = REGLAGES_DEFAUT[c.cle];
          return (
            <div key={c.cle} className="flex flex-col items-center gap-2 rounded-xl bg-zinc-800 px-1 py-3">
              <span className="text-center text-[11px] font-semibold tracking-wide text-zinc-300 uppercase">{c.nom}</span>
              <input
                type="range"
                min={c.min}
                max={c.max}
                step={c.pas}
                value={valeur}
                onChange={(e) => changer({ [c.cle]: Number(e.target.value) } as Partial<Reglages>)}
                onDoubleClick={() => changer({ [c.cle]: neutre } as Partial<Reglages>)}
                className="h-32 accent-emerald-400 [direction:rtl] [writing-mode:vertical-lr]"
                aria-label={c.nom}
                title="Double-clic : remettre à zéro"
              />
              <span className={`font-mono text-xs ${valeur === neutre ? "text-zinc-500" : "text-emerald-300"}`}>{c.lire(valeur)}</span>
            </div>
          );
        })}
      </div>

      {/* Effets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Effet</span>
        {EFFETS.map((e) => (
          <BoutonConsole key={e.valeur} actif={reglages.effet === e.valeur} onClick={() => changer({ effet: e.valeur })}>
            {e.nom}
          </BoutonConsole>
        ))}
        <span className="mx-2 h-5 w-px bg-zinc-700" />
        <BoutonConsole actif={reglages.compresseur} onClick={() => changer({ compresseur: !reglages.compresseur })}>
          Compresseur {reglages.compresseur ? "ON" : "OFF"}
        </BoutonConsole>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-700 pt-3">
        <button type="button" className="bouton" disabled={!son || Boolean(envoi)} onClick={() => void enregistrer()}>
          {envoi ?? "💾 Enregistrer pour le montage"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-zinc-600 px-3 py-2 text-sm font-semibold disabled:opacity-40"
          disabled={!son || Boolean(envoi)}
          onClick={() => void telecharger()}
        >
          ⬇ Télécharger (WAV)
        </button>
        {piste.voixId && <AjoutPreset voixId={piste.voixId} reglages={reglages} />}
      </div>
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {erreur && <p className="text-sm text-red-300">{erreur}</p>}
      <p className="text-xs text-zinc-500">
        Hauteur et vitesse se règlent séparément. « Âge » fait trembler la voix comme celle d&apos;une personne âgée. Double-cliquez un
        curseur pour le remettre à zéro.
      </p>
    </div>
  );
}

function BoutonConsole({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
        actif ? "border-emerald-400 bg-emerald-400/20 text-emerald-200" : "border-zinc-600 bg-zinc-800 text-zinc-200 hover:border-zinc-400"
      }`}
    >
      {actif && <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-400 align-middle" />}
      {children}
    </button>
  );
}
