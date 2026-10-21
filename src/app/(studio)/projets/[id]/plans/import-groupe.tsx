"use client";

import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { decouperScript } from "@/lib/decoupage";
import { envoyerPhoto } from "@/lib/envoi-photo";
import { importerPlans } from "./actions";

// Ajout en une fois : toutes les photos + le script découpé en scènes. Photo n°1 → scène 1, etc.
// On peut le refaire autant de fois qu'il faut : les nouveaux plans s'ajoutent à la suite.
export function ImportGroupe({ projectId, scenario }: { projectId: string; scenario: string }) {
  const [script, setScript] = useState(scenario);
  const [photos, setPhotos] = useState<File[]>([]);
  const [accord, setAccord] = useState(true);
  const [avancement, setAvancement] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  const scenes = useMemo(() => decouperScript(script), [script]);
  const apercus = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  const total = Math.max(scenes.length, photos.length);

  function lancer() {
    setErreur(null);
    demarrer(async () => {
      try {
        const chemins: string[] = [];
        for (let i = 0; i < photos.length; i++) {
          setAvancement(`Envoi des photos : ${i + 1} / ${photos.length}`);
          chemins.push(await envoyerPhoto(projectId, photos[i]));
        }
        setAvancement("Création des plans…");
        await importerPlans(
          projectId,
          script,
          Array.from({ length: total }, (_, i) => ({
            voix: scenes[i]?.voix ?? "",
            mouvement: scenes[i]?.mouvement ?? "",
            image_path: chemins[i] ?? null,
          })),
          accord,
        );
      } catch (e) {
        unstable_rethrow(e);
        setErreur(e instanceof Error ? e.message : String(e));
      } finally {
        setAvancement(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="etiquette" htmlFor="script-groupe">
            Script (scènes séparées par « Scène 1 », « Scène 2 »… ou « --- »)
          </label>
          <textarea
            id="script-groupe"
            rows={10}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={"Scène 1\nVoix : Bienvenue à l'hôtel Anjary.\nMouvement : slow drone shot over the hotel\n\nScène 2\n…"}
            className="champ font-mono text-sm"
          />
          <p className="mt-1 text-xs text-sourdine">
            Une ligne « Mouvement : … » dans une scène donne le mouvement de la caméra. Le reste devient le texte de la voix off.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label className="etiquette" htmlFor="photos-groupe">
            Photos (dans l'ordre des scènes : triées par nom de fichier)
          </label>
          <input
            id="photos-groupe"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) =>
              setPhotos(
                Array.from(e.target.files ?? []).sort((a, b) =>
                  a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" }),
                ),
              )
            }
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:font-semibold file:text-accent-texte"
          />
          {photos.length > 0 && (
            <ul className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {photos.map((f, i) => (
                <li key={f.name + i} className="text-[10px] text-sourdine">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={apercus[i]} alt="" className="aspect-square w-full rounded-md object-cover" />
                  {i + 1}. {f.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm">
        <b>{scenes.length}</b> scène{scenes.length > 1 ? "s" : ""} trouvée{scenes.length > 1 ? "s" : ""} et <b>{photos.length}</b>{" "}
        photo{photos.length > 1 ? "s" : ""} : <b>{total}</b> plan{total > 1 ? "s" : ""} seront créés (≈ {total * 5} s de vidéo).
        {scenes.length !== photos.length && total > 0 && (
          <span className="block text-sourdine">
            Les nombres ne correspondent pas : les plans en trop resteront sans {scenes.length > photos.length ? "photo" : "texte"},
            vous pourrez compléter ensuite.
          </span>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={accord} onChange={(e) => setAccord(e.target.checked)} className="mt-1" />
        Les personnes visibles sur ces photos sont d'accord pour être animées en vidéo.
      </label>
      {erreur && <p className="message-erreur">{erreur}</p>}
      <div>
        <button type="button" className="bouton" disabled={enCours || total === 0} onClick={lancer}>
          {enCours && <Roue />}
          {enCours ? (avancement ?? "Un instant…") : `Créer les ${total} plans`}
        </button>
      </div>
    </div>
  );
}
