"use client";

import { useRef, useState } from "react";
import { AGES, GENRES, LANGUES } from "@/lib/voix";
import { ajouterVoixModele } from "./actions";

// Pour les connaisseurs : une autre voix d'un modèle déjà installé sur le serveur voix
export function AjoutModele() {
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const formulaire = useRef<HTMLFormElement>(null);

  async function envoyer(formData: FormData) {
    setEnvoi(true);
    const r = await ajouterVoixModele(formData).catch(() => ({ erreur: "Connexion perdue." }));
    setMessage(r.erreur ? { ok: false, texte: r.erreur } : { ok: true, texte: "Voix ajoutée au catalogue." });
    if (!r.erreur) formulaire.current?.reset();
    setEnvoi(false);
  }

  return (
    <details className="carte">
      <summary className="cursor-pointer text-lg font-bold">⚙ Ajouter une voix d&apos;un modèle (avancé)</summary>
      <div className="mt-3 flex flex-col gap-3 text-sm text-sourdine">
        <p>
          <b>Meta MMS</b> : code de langue à 3 lettres de la page{" "}
          <a href="https://huggingface.co/models?other=mms&search=mms-tts" target="_blank" rel="noreferrer" className="lien">
            facebook/mms-tts-…
          </a>{" "}
          (ex. <code>fra</code>, <code>eng</code>, <code>swh</code>), usage non commercial. <b>Kokoro</b> : nom de voix de la page{" "}
          <a href="https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md" target="_blank" rel="noreferrer" className="lien">
            VOICES.md
          </a>{" "}
          (ex. <code>af_heart</code> ; le japonais n&apos;est pas installé). <b>Chatterbox</b> : code de langue à 2 lettres (ex.{" "}
          <code>pl</code>, <code>sv</code>).
        </p>
        <form ref={formulaire} action={envoyer} className="grid gap-3 md:grid-cols-3">
          <input name="nom" required placeholder="Nom de la voix" className="champ" aria-label="Nom" />
          <select name="langue" defaultValue="fr" className="champ" aria-label="Langue">
            {Object.entries(LANGUES).map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
          <select name="moteur" defaultValue="kokoro" className="champ" aria-label="Moteur">
            <option value="mms">Meta MMS</option>
            <option value="kokoro">Kokoro</option>
            <option value="chatterbox">Chatterbox</option>
          </select>
          <input name="modele" required placeholder="Code (ex. : af_heart, fra, pl)" className="champ" aria-label="Code du modèle" />
          <select name="genre" defaultValue="femme" className="champ" aria-label="Genre">
            {Object.entries(GENRES).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <select name="age" defaultValue="adulte" className="champ" aria-label="Âge">
            {Object.entries(AGES).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <input name="description" placeholder="Note (facultatif)" className="champ md:col-span-2" aria-label="Note" />
          <button type="submit" className="bouton" disabled={envoi}>
            {envoi ? "…" : "Ajouter"}
          </button>
        </form>
        {message && <p className={message.ok ? "message-ok" : "message-erreur"}>{message.texte}</p>}
      </div>
    </details>
  );
}
