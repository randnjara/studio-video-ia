"use client";

import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { importerTableau, type LigneTableau } from "./actions";

// Import d'un tableau de scènes enregistré en CSV (Excel ou Google Sheets : « Enregistrer sous… CSV »).
// Les colonnes sont reconnues par leur titre ; une ligne = un plan, dans l'ordre du fichier.

// Découpe un CSV (séparateur virgule ou point-virgule, guillemets doubles)
function lireCsv(texte: string): string[][] {
  const premiere = texte.split(/\r?\n/, 1)[0] ?? "";
  const sep = (premiere.match(/;/g)?.length ?? 0) > (premiere.match(/,/g)?.length ?? 0) ? ";" : ",";
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
  }
  if (champ || ligne.length) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes.filter((l) => l.some((c) => c.trim()));
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Mots-clés reconnus dans les titres de colonnes (le premier titre qui correspond l'emporte)
const COLONNES: Record<keyof Omit<LigneTableau, "duree">, string[]> = {
  voix: ["dialogue", "voix", "replique", "texte"],
  mouvement: ["mouvement", "motion", "prompt video"],
  description: ["description", "prompt image", "image"],
  cadrage: ["cadrage", "plan"],
  angle: ["angle"],
  lieu: ["zone decor", "decor", "lieu"],
  intention: ["intention", "emotion"],
  pose_debut: ["debut posture", "pose debut", "posture 0", "pose de debut"],
  pose_fin: ["fin posture", "pose fin", "pose de fin"],
};
const IGNORER = ["inventoriee", "officielle", "existante", "geste original"];

// Les valeurs « à définir », « à mesurer »… ne sont pas des informations
const vide = (v: string) => /^(a definir|a mesurer|a verifier|non verifie)/.test(norm(v));

function convertir(lignes: string[][], personnage: string): { plans: LigneTableau[]; reconnues: string[] } {
  const [entetes = [], ...corps] = lignes;
  const titres = entetes.map(norm);
  const index: Partial<Record<keyof LigneTableau, number>> = {};
  const reconnues: string[] = [];
  for (const [cle, mots] of Object.entries(COLONNES) as [keyof typeof COLONNES, string[]][]) {
    for (const mot of mots) {
      const i = titres.findIndex(
        (t, k) => t.includes(mot) && !IGNORER.some((x) => t.includes(x)) && !Object.values(index).includes(k),
      );
      if (i >= 0) {
        index[cle] = i;
        reconnues.push(`${entetes[i]} → ${cle}`);
        break;
      }
    }
  }
  // « Action principale proposée » complète la description de la photo
  const action = titres.findIndex((t) => t.includes("action"));
  const duree = titres.findIndex((t) => t.includes("duree reelle") || t === "duree");
  const lire = (l: string[], i?: number) => {
    const v = i === undefined || i < 0 ? "" : (l[i] ?? "").trim();
    return vide(v) ? "" : v;
  };
  const plans = corps.map((l) => {
    const morceaux = [lire(l, index.description), lire(l, action)].filter(Boolean).join(", ");
    return {
      voix: lire(l, index.voix),
      mouvement: lire(l, index.mouvement),
      description: morceaux ? `${personnage ? `${personnage}, ` : ""}${morceaux}` : "",
      cadrage: lire(l, index.cadrage),
      angle: lire(l, index.angle),
      lieu: lire(l, index.lieu),
      intention: lire(l, index.intention),
      pose_debut: lire(l, index.pose_debut),
      pose_fin: lire(l, index.pose_fin),
      duree: Number(lire(l, duree).replace(",", ".")) || null,
    };
  });
  return { plans: plans.filter((p) => p.voix || p.description || p.mouvement), reconnues };
}

export function ImportTableau({ projectId }: { projectId: string }) {
  const [texte, setTexte] = useState("");
  const [personnage, setPersonnage] = useState("");
  const [accord, setAccord] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const { plans, reconnues } = useMemo(
    () => (texte ? convertir(lireCsv(texte), personnage.trim()) : { plans: [], reconnues: [] }),
    [texte, personnage],
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-sourdine">
        Un tableau préparé ailleurs (par exemple avec ChatGPT), enregistré en CSV : une ligne par scène. Colonnes reconnues :
        dialogue, mouvement, description, action, cadrage, angle, lieu ou décor, intention, posture de début et de fin.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setTexte(f ? await f.text() : "");
        }}
      />
      <div>
        <label className="etiquette" htmlFor="personnage-tableau">
          Nom du personnage à citer dans chaque description (doit être le nom d'une référence du film)
        </label>
        <input
          id="personnage-tableau"
          value={personnage}
          onChange={(e) => setPersonnage(e.target.value)}
          placeholder="Ex. : Mama"
          className="champ text-sm"
        />
      </div>
      {texte && (
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <p className="font-semibold">{plans.length} plans trouvés</p>
          <p className="text-xs text-sourdine">{reconnues.join(" · ") || "Aucune colonne reconnue"}</p>
          {plans[0] && (
            <p className="mt-2 text-xs">
              Plan 1 : {plans[0].voix.slice(0, 80)} · {plans[0].cadrage} · {plans[0].angle} · {plans[0].lieu}
            </p>
          )}
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={accord} onChange={(e) => setAccord(e.target.checked)} className="mt-1" />
        Les personnes représentées sont d'accord pour être animées en vidéo.
      </label>
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
                await importerTableau(projectId, plans, accord);
              } catch (e) {
                unstable_rethrow(e);
                setErreur(e instanceof Error ? e.message : String(e));
              }
            })
          }
        >
          {enCours && <Roue />}
          {enCours ? "Création des plans…" : `Créer ${plans.length} plans`}
        </button>
      </div>
    </div>
  );
}
