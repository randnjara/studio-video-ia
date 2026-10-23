"use client";

import { useState } from "react";
import { FICHIER_A_REMPLIR, promptPreparation, tableauARemplir } from "@/lib/preparation";

type Ref = { nom: string; genre: string; description: string };

// Étape 2 : le fichier vide au format standard et la consigne à donner à ChatGPT.
// La voix off, le résumé et les références viennent de l'étape 1 ; ChatGPT découpe la voix off et remplit le fichier.
export function PreparationTableau(p: {
  titre: string;
  format: string;
  style: string;
  script: string;
  resume: string;
  refs: Ref[];
}) {
  const [etat, setEtat] = useState<"" | "copie" | "manuel">("");
  const [telecharge, setTelecharge] = useState(false);
  const texte = promptPreparation({
    titre: p.titre,
    format: p.format,
    style: p.style,
    script: p.script,
    resume: p.resume,
    refs: p.refs,
  });

  // Fichier .csv à joindre dans ChatGPT (avec un BOM pour qu'Excel lise bien les accents)
  function telecharger() {
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob(["﻿" + tableauARemplir()], { type: "text/csv;charset=utf-8" }));
    lien.download = FICHIER_A_REMPLIR;
    lien.click();
    URL.revokeObjectURL(lien.href);
    setTelecharge(true);
  }

  async function copier() {
    try {
      await navigator.clipboard.writeText(texte);
      setEtat("copie");
    } catch {
      setEtat("manuel");
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">a.</span>
        <button type="button" className="bouton-discret" onClick={telecharger}>
          ⬇ Télécharger le fichier à remplir (.csv)
        </button>
        {telecharge && <span className="text-succes">Téléchargé : {FICHIER_A_REMPLIR}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold">b.</span>
        <button type="button" className="bouton" onClick={copier}>
          📋 Copier la consigne
        </button>
        {etat === "copie" && <span className="text-succes">Copiée.</span>}
      </div>
      {etat === "manuel" && (
        <textarea readOnly className="champ h-48 font-mono text-xs" value={texte} onFocus={(e) => e.target.select()} />
      )}
      <p className="text-sourdine">
        <span className="font-semibold text-encre">c.</span> Dans ChatGPT ou Claude (claude.ai), ouvrez une nouvelle conversation : collez la consigne,
        puis joignez la photo du personnage principal et le fichier à remplir (il contient une ligne d'exemple, que l'assistant supprimera).
        {p.script.trim() ? "" : " Joignez aussi votre voix off (texte ou fichier), puisqu'elle n'est pas dans l'étape 1."}
      </p>
    </div>
  );
}
