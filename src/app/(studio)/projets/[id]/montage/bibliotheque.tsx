"use client";

import { useState } from "react";
import { envoyerPhoto } from "@/lib/envoi-photo";
import type { Media, Nature } from "@/lib/montage";
import { createClient } from "@/lib/supabase/client";

// Les médias du montage : clips validés, photos de départ des plans, et vos fichiers (voix off, musique, vidéos, images)

const TAILLE_MAX = 50 * 1024 * 1024;

function natureDe(f: File): Nature | null {
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  return /\.(mp3|m4a|wav|aac|ogg)$/i.test(f.name) ? "audio" : null;
}

function mesurer(f: File, nature: Nature): Promise<number | null> {
  if (nature === "image") return Promise.resolve(null);
  return new Promise((ok) => {
    const el = document.createElement(nature === "audio" ? "audio" : "video");
    const url = URL.createObjectURL(f);
    el.preload = "metadata";
    el.onloadedmetadata = () => (URL.revokeObjectURL(url), ok(Number.isFinite(el.duration) ? el.duration : null));
    el.onerror = () => (URL.revokeObjectURL(url), ok(null));
    el.src = url;
  });
}

async function envoyer(projectId: string, f: File, nature: Nature): Promise<string> {
  if (nature === "image") return envoyerPhoto(projectId, f);
  const ext = (f.name.split(".").pop() || (nature === "audio" ? "mp3" : "mp4")).toLowerCase();
  const chemin = `${projectId}/montage/${crypto.randomUUID()}.${ext}`;
  const type = f.type || (ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : ext === "wav" ? "audio/wav" : "application/octet-stream");
  const { error } = await createClient().storage.from("medias").upload(chemin, f, { contentType: type });
  if (error) {
    throw new Error(
      error.message.toLowerCase().includes("mime")
        ? `« ${f.name} » : ce type de fichier n'est pas encore accepté (migration 0012 à appliquer).`
        : `Envoi de « ${f.name} » impossible : ${error.message}`,
    );
  }
  return chemin;
}

export function Bibliotheque({
  projectId,
  clips,
  photos,
  voix,
  fichiers,
  liens,
  modifiable,
  onAjouter,
  onImporte,
}: {
  projectId: string;
  clips: Media[];
  photos: Media[];
  voix: Media[];
  fichiers: Media[];
  liens: Map<string, string>;
  modifiable: boolean;
  onAjouter: (m: Media) => void;
  onImporte: (m: Media) => void;
}) {
  const [onglet, setOnglet] = useState<"clips" | "photos" | "voix" | "fichiers">("clips");
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const liste = onglet === "clips" ? clips : onglet === "photos" ? photos : onglet === "voix" ? voix : fichiers;

  async function importer(files: FileList | null) {
    setErreur(null);
    for (const f of Array.from(files ?? [])) {
      const nature = natureDe(f);
      if (!nature) {
        setErreur(`« ${f.name} » n'est ni une vidéo, ni une image, ni un son.`);
        continue;
      }
      if (f.size > TAILLE_MAX) {
        setErreur(`« ${f.name} » dépasse 50 Mo.`);
        continue;
      }
      setEnvoi(`Envoi de « ${f.name} »…`);
      try {
        const [duree, chemin] = await Promise.all([mesurer(f, nature), envoyer(projectId, f, nature)]);
        onImporte({ chemin, nature, nom: f.name.replace(/\.[^.]+$/, ""), duree });
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Envoi impossible.");
      }
    }
    setEnvoi(null);
    setOnglet("fichiers");
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-1 text-xs">
        {(
          [
            ["clips", `Clips (${clips.length})`],
            ["photos", `Photos des plans (${photos.length})`],
            ["voix", `Voix (${voix.length})`],
            ["fichiers", `Mes fichiers (${fichiers.length})`],
          ] as const
        ).map(([o, libelle]) => (
          <button
            key={o}
            type="button"
            onClick={() => setOnglet(o)}
            className={`rounded-full border px-2.5 py-0.5 font-semibold ${onglet === o ? "border-accent bg-accent-doux text-accent" : "border-ligne text-sourdine"}`}
          >
            {libelle}
          </button>
        ))}
      </div>

      {modifiable && (
        <label className="bouton-discret cursor-pointer py-1.5 text-xs">
          {envoi ?? "⬆ Importer voix off, musique, vidéo ou image"}
          <input
            type="file"
            multiple
            accept="audio/*,video/*,image/*,.mp3,.m4a,.wav"
            className="hidden"
            disabled={Boolean(envoi)}
            onChange={(e) => (void importer(e.target.files), (e.target.value = ""))}
          />
        </label>
      )}
      {erreur && <p className="message-erreur text-xs">{erreur}</p>}

      {liste.length === 0 ? (
        <p className="text-xs text-sourdine">
          {onglet === "clips"
            ? "Aucun clip validé."
            : onglet === "photos"
              ? "Aucune photo de départ."
              : onglet === "voix"
                ? "Aucune voix : créez-en dans le Studio voix du projet."
              : "Importez ici la voix off enregistrée, une musique libre de droits, ou d'autres images et vidéos."}
        </p>
      ) : (
        <ul className="grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
          {liste.map((m) => {
            const url = liens.get(m.chemin);
            return (
              <li key={m.chemin} className="flex flex-col gap-1 rounded-lg border border-ligne p-1.5">
                {m.nature === "audio" ? (
                  <div className="flex aspect-video items-center justify-center rounded bg-emerald-600/15 text-2xl">🎵</div>
                ) : m.nature === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={m.nom} className="aspect-video w-full rounded bg-black object-cover" />
                ) : (
                  <video src={url} muted playsInline preload="metadata" className="aspect-video w-full rounded bg-black object-cover" />
                )}
                <span className="truncate text-xs" title={m.nom}>
                  <b>{m.nom}</b>
                  {m.duree ? <span className="text-sourdine"> · {m.duree.toFixed(1)} s</span> : null}
                </span>
                {modifiable && (
                  <button type="button" className="bouton-discret px-2 py-0.5 text-xs" onClick={() => onAjouter(m)}>
                    + Ajouter
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-sourdine">
        Vidéos et images vont sur la piste principale, ou sur la piste vidéo choisie (cliquez son nom). Les sons se posent au curseur.
      </p>
    </div>
  );
}
