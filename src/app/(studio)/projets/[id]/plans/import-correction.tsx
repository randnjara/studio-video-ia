"use client";

import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { corrigerPlans, type LigneCorrection } from "./actions";
import { lireCsv } from "./import-tableau";

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

// Lit le fichier corrigé (colonnes du prompt de vérification) ; le bloc ```csv collé tel quel est aussi accepté
function lire(texte: string, nbPlans: number, avecPhoto: number[]) {
  const brut = texte.replace(/^\s*```(?:csv)?\s*$/gim, "");
  const [entetes = [], ...lignes] = lireCsv(brut);
  const col = new Map(entetes.map((e, i) => [norm(e), i]));
  const v = (l: string[], nom: string) => (col.has(nom) ? (l[col.get(nom)!] ?? "").trim() : "");
  const plans: (LigneCorrection & { corrige: boolean; probleme: string })[] = [];
  for (const l of lignes) {
    const numero = Number(v(l, "numero"));
    if (!Number.isInteger(numero) || numero < 1 || numero > nbPlans) continue;
    plans.push({
      numero,
      corrige: !/^ok$/i.test(v(l, "verdict")),
      probleme: v(l, "probleme"),
      // Un plan sans photo n'a rien à refaire : sa photo sera créée après
      photoARefaire: avecPhoto.includes(numero) && /^(oui|yes|o|y)$/i.test(v(l, "photo_a_refaire")),
      duree: Number(v(l, "duree").replace(",", ".")) || null,
      intention: v(l, "intention"),
      cadrage: v(l, "cadrage"),
      angle: v(l, "angle"),
      lieu: v(l, "lieu"),
      pose_debut: v(l, "pose_debut"),
      pose_fin: v(l, "pose_fin"),
      description: v(l, "prompt_image"),
      mouvement: v(l, "prompt_video"),
    });
  }
  return { plans, reconnu: col.has("numero") && (col.has("prompt_video") || col.has("prompt_image")) };
}

// Réimport du tableau corrigé par l'assistant : met à jour les plans existants, sans en créer
export function ImportCorrection({ projectId, nbPlans, avecPhoto }: { projectId: string; nbPlans: number; avecPhoto: number[] }) {
  const [texte, setTexte] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const { plans, reconnu } = useMemo(
    () => (texte ? lire(texte, nbPlans, avecPhoto) : { plans: [], reconnu: false }),
    [texte, nbPlans, avecPhoto],
  );
  const corriges = plans.filter((p) => p.corrige);
  const photos = plans.filter((p) => p.photoARefaire);

  return (
    <details className="carte text-sm">
      <summary className="cursor-pointer font-semibold">Importer le tableau corrigé par la vérification</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sourdine">
          Choisissez le fichier tableau_corrige.csv donné par l'assistant. Les plans existants sont mis à jour par leur
          numéro (prompts, poses, cadrage, durée) ; les répliques et les photos ne sont pas touchées.
        </p>
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          aria-label="Tableau corrigé"
          className="text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setTexte(f ? await f.text() : "");
          }}
        />
        {texte && !reconnu && (
          <p className="message-erreur">
            Ce fichier n'a pas les colonnes du tableau corrigé (numero, prompt_image, prompt_video…). Recopiez le prompt de
            vérification et redemandez le fichier.
          </p>
        )}
        {reconnu && (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="font-semibold">
              {plans.length} plans lus · {corriges.length} corrigés · {photos.length} photo{photos.length > 1 ? "s" : ""} à
              refaire
            </p>
            {corriges.length > 0 && (
              <ul className="mt-2 max-h-48 overflow-auto text-xs">
                {corriges.map((p) => (
                  <li key={p.numero}>
                    Plan {p.numero}
                    {p.photoARefaire ? " (photo à refaire)" : ""} : {p.probleme || "corrigé"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {erreur && <p className="message-erreur">{erreur}</p>}
        <div>
          <button
            type="button"
            className="bouton"
            disabled={enCours || plans.length === 0}
            onClick={() =>
              demarrer(async () => {
                setErreur(null);
                try {
                  await corrigerPlans(projectId, plans);
                } catch (e) {
                  unstable_rethrow(e);
                  setErreur(e instanceof Error ? e.message : String(e));
                }
              })
            }
          >
            {enCours && <Roue />}
            {enCours ? "Mise à jour…" : `Mettre à jour les plans`}
          </button>
        </div>
      </div>
    </details>
  );
}
