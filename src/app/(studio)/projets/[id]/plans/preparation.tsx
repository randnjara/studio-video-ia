"use client";

import { useState } from "react";
import { FICHIER_A_REMPLIR, promptPreparation, tableauARemplir } from "@/lib/preparation";
import { enregistrerScript } from "./actions";

type Ref = { nom: string; genre: string; description: string };

// Préparation du tableau des plans avec ChatGPT : le studio donne la consigne et le fichier vide au format standard,
// ChatGPT découpe la voix off en plans et remplit le fichier, qui se réimporte tel quel. La voix off collée ici est facultative.
export function PreparationTableau(p: {
  projectId: string;
  titre: string;
  format: string;
  style: string;
  script: string;
  resume: string;
  refs: Ref[];
}) {
  const [voix, setVoix] = useState(p.script);
  const [resume, setResume] = useState(p.resume);
  const [etat, setEtat] = useState<"" | "copie" | "manuel">("");
  const texte = promptPreparation({ titre: p.titre, format: p.format, style: p.style, script: voix, resume, refs: p.refs });

  const garder = () => {
    if (voix.trim() !== p.script.trim() || resume.trim() !== p.resume.trim())
      enregistrerScript(p.projectId, voix, resume).catch(() => undefined);
  };

  // Fichier .csv à joindre dans ChatGPT (avec un BOM pour qu'Excel lise bien les accents)
  function telecharger() {
    garder();
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob(["\ufeff" + tableauARemplir()], { type: "text/csv;charset=utf-8" }));
    lien.download = FICHIER_A_REMPLIR;
    lien.click();
    URL.revokeObjectURL(lien.href);
  }

  async function copier() {
    garder();
    try {
      await navigator.clipboard.writeText(texte);
      setEtat("copie");
    } catch {
      setEtat("manuel");
    }
  }

  return (
    <details className="rounded-lg border border-ligne p-4 text-sm">
      <summary className="cursor-pointer font-semibold">🤖 Préparer le tableau des plans avec ChatGPT (gratuit)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="space-y-1 text-sourdine">
          <p>1. Plus bas, dans « Références du film », ajoutez au moins la photo du personnage principal avec son nom. Le reste est facultatif.</p>
          <p>2. Téléchargez le fichier vide et copiez la consigne.</p>
          <p>
            3.
            Dans ChatGPT : collez la consigne, joignez la photo du personnage, le fichier vide et votre voix off (texte ou
            fichier). ChatGPT découpe la voix off en plans et remplit le fichier.
          </p>
          <p>4. Téléchargez le fichier rempli et importez-le juste en dessous, sans rien changer.</p>
        </div>
        <div>
          <label className="etiquette" htmlFor="resume-preparation">
            Résumé ou but du film (facultatif, quelques phrases)
          </label>
          <textarea
            id="resume-preparation"
            rows={3}
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            placeholder="Ex. : Mama, grand-mère malgache, parle avec tendresse à ses petits-enfants partis loin. Film d'environ 5 minutes."
            className="champ text-sm"
          />
        </div>
        <div>
          <label className="etiquette" htmlFor="voix-preparation">
            Voix off (facultatif : collez-la ici pour qu'elle soit dans la consigne et gardée dans le projet)
          </label>
          <textarea
            id="voix-preparation"
            rows={6}
            value={voix}
            onChange={(e) => setVoix(e.target.value)}
            className="champ text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="bouton-discret" onClick={telecharger}>
            ⬇ Fichier vide à remplir (.csv)
          </button>
          <button type="button" className="bouton" onClick={copier}>
            📋 Copier la consigne pour ChatGPT
          </button>
          {etat === "copie" && <span className="text-succes">Copié. Collez-la dans ChatGPT avec la photo, le fichier vide et la voix off.</span>}
        </div>
        {etat === "manuel" && (
          <textarea readOnly className="champ h-48 font-mono text-xs" value={texte} onFocus={(e) => e.target.select()} />
        )}
      </div>
    </details>
  );
}
