"use client";

import { useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { creerLienConnexion } from "./actions";

// Crée un lien de connexion à envoyer soi-même au membre (sans passer par l'e-mail)
export function LienConnexion({ userId, nom }: { userId: string; nom: string }) {
  const [lien, setLien] = useState("");
  const [erreur, setErreur] = useState("");
  const [copie, setCopie] = useState(false);
  const [enCours, demarrer] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          className="bouton-discret px-3 py-1 text-sm"
          disabled={enCours}
          onClick={() =>
            demarrer(async () => {
              setErreur("");
              setCopie(false);
              const r = await creerLienConnexion(userId);
              setLien(r.lien ?? "");
              setErreur(r.erreur ?? "");
            })
          }
        >
          {enCours && <Roue />}
          Créer un lien de connexion à copier
        </button>
      </div>
      {erreur && <p className="text-sm text-alerte">{erreur}</p>}
      {lien && (
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <p>
            Envoyez ce lien à {nom} (WhatsApp, Messenger…). Valable une heure, une seule fois, sur n'importe quel appareil.
            Ne l'ouvrez pas vous-même : il vous connecterait à sa place.
          </p>
          <input readOnly value={lien} className="champ mt-2 text-xs" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="bouton mt-2 px-3 py-1 text-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(lien);
              setCopie(true);
            }}
          >
            {copie ? "Lien copié." : "Copier le lien"}
          </button>
        </div>
      )}
    </div>
  );
}
