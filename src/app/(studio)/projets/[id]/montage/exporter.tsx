"use client";

import { useEffect, useRef, useState } from "react";
import { type Timeline, placer } from "@/lib/montage";
import { type Qualite, exporter } from "./rendu";

// Téléchargement du film en un seul fichier, calculé par cet ordinateur (gratuit)
export function Exporter({ timeline, liens, format, titre }: { timeline: Timeline; liens: Map<string, string>; format: string; titre: string }) {
  const [enCours, setEnCours] = useState<{ qualite: Qualite; part: number; etape: string } | null>(null);
  const [resultat, setResultat] = useState<{ url: string; nom: string; taille: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const arret = useRef<AbortController | null>(null);
  const debut = useRef(0);
  const vide = placer(timeline).duree === 0;

  useEffect(() => () => void (resultat && URL.revokeObjectURL(resultat.url)), [resultat]);

  async function lancer(qualite: Qualite) {
    setErreur(null);
    setResultat(null);
    arret.current = new AbortController();
    debut.current = performance.now();
    setEnCours({ qualite, part: 0, etape: "Préparation…" });
    try {
      const { blob, extension } = await exporter(
        timeline,
        liens,
        format,
        qualite,
        (part, etape) => setEnCours({ qualite, part, etape }),
        arret.current.signal,
      );
      const nom = `${titre.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "montage"}-${qualite}.${extension}`;
      const url = URL.createObjectURL(blob);
      setResultat({ url, nom, taille: blob.size });
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setErreur(e instanceof Error ? `Export impossible : ${e.message}` : "Export impossible.");
    }
    setEnCours(null);
  }

  const ecoule = enCours ? (performance.now() - debut.current) / 1000 : 0;
  const reste = enCours && enCours.part > 0.03 ? Math.round((ecoule / enCours.part) * (1 - enCours.part)) : null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ligne p-4">
      <div>
        <p className="font-bold">Télécharger le film</p>
        <p className="text-xs text-sourdine">
          Le film est calculé par votre ordinateur (gratuit, rien n'est envoyé). Gardez cet onglet ouvert pendant le calcul. Chrome ou
          Edge conseillés.
        </p>
      </div>
      {enCours ? (
        <div className="flex flex-col gap-2">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(enCours.part * 100)}%` }} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>
              {enCours.qualite} · {enCours.etape} {Math.round(enCours.part * 100)} %
              {reste !== null && <span className="text-sourdine"> · encore environ {reste < 60 ? `${reste} s` : `${Math.ceil(reste / 60)} min`}</span>}
            </span>
            <button type="button" className="bouton-danger ml-auto" onClick={() => arret.current?.abort()}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="bouton-discret" disabled={vide} onClick={() => void lancer("480p")}>
            ⬇ 480p (léger, WhatsApp)
          </button>
          <button type="button" className="bouton" disabled={vide} onClick={() => void lancer("720p")}>
            ⬇ 720p HD
          </button>
        </div>
      )}
      {resultat && (
        <p className="message-ok flex flex-wrap items-center gap-2">
          Film prêt ({(resultat.taille / 1024 / 1024).toFixed(1)} Mo).
          <a href={resultat.url} download={resultat.nom} className="lien">
            Télécharger {resultat.nom}
          </a>
        </p>
      )}
      {erreur && <p className="message-erreur">{erreur}</p>}
    </div>
  );
}
