"use client";

import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  UrlSource,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type WrappedCanvas,
} from "mediabunny";
import { DIMENSIONS, type Place, type Timeline, dessiner, placer, programmerSons, tempsSource, visiblesA } from "@/lib/montage";

// Export du film, entièrement dans le navigateur : les images sont composées sur un canvas puis encodées par
// l'encodeur vidéo de l'ordinateur (WebCodecs, via la librairie libre Mediabunny). Gratuit, rien n'est envoyé.

const TAUX = 48000;
const IMAGES_PAR_SECONDE = 24;

// Un fichier a-t-il du son à mixer ? Les clips générés par le studio sont muets.
export const avecSon = (e: { nature: string; takeId?: string }) => e.nature === "audio" || (e.nature === "video" && !e.takeId);

let decodeur: OfflineAudioContext | null = null;
const sonsEnCache = new Map<string, Promise<AudioBuffer | null>>();

// Décode un fichier son (ou le son d'une vidéo) ; null s'il n'y a pas de son
export function chargerSon(chemin: string, url: string) {
  let p = sonsEnCache.get(chemin);
  if (!p) {
    decodeur ??= new OfflineAudioContext(2, 1, TAUX);
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("lecture"))))
      .then((data) => decodeur!.decodeAudioData(data))
      .catch(() => null);
    sonsEnCache.set(chemin, p);
  }
  return p;
}

export async function chargerSons(places: Place[], liens: Map<string, string>) {
  const sons = new Map<string, AudioBuffer>();
  const chemins = [...new Set(places.filter((p) => avecSon(p.element)).map((p) => p.element.chemin))];
  await Promise.all(
    chemins.map(async (c) => {
      const url = liens.get(c);
      const b = url ? await chargerSon(c, url) : null;
      if (b) sons.set(c, b);
    }),
  );
  return sons;
}

type Lecteur =
  | { type: "image"; bitmap: ImageBitmap }
  | {
      type: "video";
      input: Input;
      it: AsyncGenerator<WrappedCanvas, void, unknown>;
      actuel: WrappedCanvas | null;
      suivant: WrappedCanvas | null;
    };

async function ouvrir(p: Place, url: string, largeur: number, hauteur: number): Promise<Lecteur | null> {
  if (p.element.nature === "image") {
    const blob = await (await fetch(url)).blob();
    return { type: "image", bitmap: await createImageBitmap(blob) };
  }
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  const piste = await input.getPrimaryVideoTrack();
  if (!piste) {
    input.dispose();
    return null;
  }
  const sink = new CanvasSink(piste, { width: largeur, height: hauteur, fit: "cover" });
  const it = sink.canvases(p.element.coupeDebut, p.element.coupeDebut + p.element.longueur + 0.5);
  const actuel = (await it.next()).value ?? null;
  const suivant = actuel ? ((await it.next()).value ?? null) : null;
  return { type: "video", input, it, actuel, suivant };
}

async function imageVideo(l: Extract<Lecteur, { type: "video" }>, ts: number) {
  while (l.suivant && l.suivant.timestamp <= ts + 1e-3) {
    l.actuel = l.suivant;
    l.suivant = (await l.it.next()).value ?? null;
  }
  return l.actuel;
}

function fermer(l: Lecteur | null) {
  if (!l) return;
  if (l.type === "image") l.bitmap.close();
  else {
    void l.it.return(undefined);
    l.input.dispose();
  }
}

export type Qualite = "480p" | "720p";

export async function exporter(
  timeline: Timeline,
  liens: Map<string, string>,
  format: string,
  qualite: Qualite,
  progres: (part: number, etape: string) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; extension: string }> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("Ce navigateur ne sait pas encoder de vidéo. Utilisez Chrome, Edge ou Safari (version récente).");
  }
  const { places, duree } = placer(timeline);
  if (duree <= 0) throw new Error("Le montage est vide.");
  const [largeur, hauteur] = (DIMENSIONS[format] ?? DIMENSIONS["9:16"])[qualite];
  const qualiteVideo = qualite === "720p" ? QUALITY_HIGH : QUALITY_MEDIUM;

  // MP4 (H.264 + AAC) partout où c'est possible ; sinon WebM, lisible sur ordinateur
  let mp4 = await canEncodeVideo("avc", { width: largeur, height: hauteur, quality: qualiteVideo });
  if (mp4 && !(await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: TAUX }))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }
  let codecVideo: "avc" | "vp9" | "vp8" = "avc";
  if (!mp4) codecVideo = (await canEncodeVideo("vp9", { width: largeur, height: hauteur })) ? "vp9" : "vp8";
  mp4 = codecVideo === "avc";

  // 1. Le son : tout est mixé d'un coup (volumes, fondus), comme dans l'aperçu
  progres(0, "Préparation du son…");
  const sons = await chargerSons(places, liens);
  const mixeur = new OfflineAudioContext(2, Math.ceil(duree * TAUX), TAUX);
  programmerSons(mixeur, places, sons, 0, 0);
  const mix = await mixeur.startRendering();
  if (signal.aborted) throw new DOMException("annulé", "AbortError");

  // 2. La sortie
  const canvas = new OffscreenCanvas(largeur, hauteur);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const cible = new BufferTarget();
  const sortie = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: cible,
  });
  const video = new CanvasSource(canvas, { codec: codecVideo, quality: qualiteVideo, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: mp4 ? "aac" : "opus", quality: QUALITY_HIGH });
  sortie.addVideoTrack(video, { frameRate: IMAGES_PAR_SECONDE });
  sortie.addAudioTrack(audio);
  await sortie.start();

  const lecteurs = new Map<Place, Promise<Lecteur | null>>();
  const total = Math.ceil(duree * IMAGES_PAR_SECONDE);
  const morceau = TAUX; // le son est ajouté par tranches d'une seconde, au rythme des images
  let sonEnvoye = 0;

  try {
    for (let n = 0; n < total; n++) {
      if (signal.aborted) throw new DOMException("annulé", "AbortError");
      const t = n / IMAGES_PAR_SECONDE;

      // Ouvre les plans qui arrivent, ferme ceux qui sont passés
      for (const p of places) {
        if (p.element.nature === "audio") continue;
        const actif = t >= p.debut - 0.5 && t < p.fin;
        if (actif && !lecteurs.has(p)) {
          const url = liens.get(p.element.chemin);
          lecteurs.set(p, url ? ouvrir(p, url, largeur, hauteur).catch(() => null) : Promise.resolve(null));
        } else if (!actif && lecteurs.has(p)) {
          fermer(await lecteurs.get(p)!);
          lecteurs.delete(p);
        }
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, largeur, hauteur);
      for (const p of visiblesA(places, t)) {
        const l = await lecteurs.get(p);
        if (!l) continue;
        if (l.type === "image") dessiner(ctx, l.bitmap, l.bitmap.width, l.bitmap.height, p, t, largeur, hauteur);
        else {
          const img = await imageVideo(l, tempsSource(p, t));
          if (img) dessiner(ctx, img.canvas, img.canvas.width, img.canvas.height, p, t, largeur, hauteur);
        }
      }
      await video.add(t, 1 / IMAGES_PAR_SECONDE);

      while (sonEnvoye < mix.length && sonEnvoye <= (t + 1) * TAUX) {
        const longueur = Math.min(morceau, mix.length - sonEnvoye);
        const tranche = new AudioBuffer({ length: longueur, numberOfChannels: 2, sampleRate: TAUX });
        for (let c = 0; c < 2; c++) tranche.copyToChannel(mix.getChannelData(c).subarray(sonEnvoye, sonEnvoye + longueur), c);
        await audio.add(tranche);
        sonEnvoye += longueur;
      }
      if (n % 6 === 0) progres(n / total, "Calcul des images…");
    }
    progres(1, "Finalisation…");
    await sortie.finalize();
  } catch (e) {
    await sortie.cancel().catch(() => {});
    throw e;
  } finally {
    for (const l of lecteurs.values()) fermer(await l);
  }

  return {
    blob: new Blob([cible.buffer!], { type: mp4 ? "video/mp4" : "video/webm" }),
    extension: mp4 ? "mp4" : "webm",
  };
}
