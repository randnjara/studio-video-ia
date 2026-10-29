"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { noterConnexionReussie, noterErreurLien } from "./actions";

// Les e-mails par défaut de Supabase (invitation envoyée depuis le tableau de bord ou la page Équipe)
// renvoient ici avec la session dans l'adresse, après le « # ». Le serveur ne la voit pas :
// on l'enregistre côté navigateur, puis on ouvre l'application.
export function SessionDepuisLien() {
  const [etat, setEtat] = useState<"rien" | "connexion" | "erreur">("rien");

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (params.get("error")) {
      setEtat("erreur");
      noterErreurLien(`${params.get("error_code") ?? params.get("error")} : ${params.get("error_description") ?? ""}`);
      history.replaceState(null, "", window.location.pathname);
      return;
    }
    if (!accessToken || !refreshToken) return;

    setEtat("connexion");
    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setEtat("erreur");
          noterErreurLien(`session : ${error.message}`);
          history.replaceState(null, "", window.location.pathname);
        } else {
          // Lien « mot de passe oublié » : on va directement choisir le nouveau mot de passe
          const suite = params.get("type") === "recovery" ? "/compte?nouveau=1" : "/";
          noterConnexionReussie().finally(() => window.location.replace(suite));
        }
      });
  }, []);

  if (etat === "connexion") {
    return <p className="rounded-md bg-accent-doux px-4 py-2 text-sm">Connexion en cours…</p>;
  }
  if (etat === "erreur") {
    return (
      <p className="text-sm text-alerte">
        Ce lien a expiré ou a déjà servi. Connectez-vous avec votre mot de passe, ou demandez-en un nouveau.
      </p>
    );
  }
  return null;
}
