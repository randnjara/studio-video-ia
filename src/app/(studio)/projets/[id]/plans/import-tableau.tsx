"use client";

import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { importerTableau, type LigneTableau } from "./actions";

// Import d'un tableau de scènes enregistré en CSV (Excel ou Google Sheets : « Enregistrer sous… CSV »).
// Les colonnes sont reconnues par leur titre ; une ligne = un plan, dans l'ordre du fichier.

// Découpe un CSV (séparateur virgule ou point-virgule, guillemets doubles)
export function lireCsv(texte: string): string[][] {
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

// Scénario au format Markdown (« ## SCÈNE 01 … **Texte exact :** … **PROMPT IMAGE :** … ») : converti en tableau
function lireScenario(texte: string): string[][] {
  const champ = (bloc: string, nom: string) =>
    (bloc.match(new RegExp(`\\*\\*${nom}\\s*:\\*\\*\\s*(.*)`, "i"))?.[1] ?? "").split(" · **")[0].trim();
  const scenes = texte.split(/^##\s+SC[ÈE]NE\s+/im).slice(1);
  return [
    ["voix", "intention", "cadrage", "lieu", "pose debut", "pose fin", "description", "mouvement"],
    ...scenes.map((b) => [
      champ(b, "Texte exact").replace(/^[«"“]\s*|\s*[»"”]$/g, ""),
      champ(b, "Émotion"),
      champ(b, "Cadrage"),
      champ(b, "Lieu"),
      champ(b, "Départ"),
      champ(b, "Fin"),
      champ(b, "PROMPT IMAGE"),
      champ(b, "PROMPT VIDÉO"),
    ]),
  ];
}

// Retire le texte recopié au début et à la fin de toutes les cellules d'une colonne (règles générales répétées
// dans chaque prompt) : le studio les ajoute déjà lui-même, et elles masquent ce qui est propre au plan.
export function retirerCommun(valeurs: string[]): { valeurs: string[]; retire: string } {
  const pleines = valeurs.filter((v) => v.trim());
  if (pleines.length < 3) return { valeurs, retire: "" };
  let debut = pleines.reduce((a, v) => {
    let i = 0;
    while (i < a.length && i < v.length && a[i] === v[i]) i++;
    return a.slice(0, i);
  });
  debut = debut.slice(0, Math.max(debut.lastIndexOf(". "), debut.lastIndexOf("; ")) + 1);
  let fin = pleines.reduce((a, v) => {
    let i = 0;
    while (i < a.length && i < v.length && a[a.length - 1 - i] === v[v.length - 1 - i]) i++;
    return a.slice(a.length - i);
  });
  const coupe = Math.min(...[". ", "; "].map((m) => fin.indexOf(m)).filter((i) => i >= 0), fin.length);
  fin = fin.slice(coupe + 1).trimStart();
  if (debut.length < 40) debut = "";
  if (fin.length < 40) fin = "";
  if (!debut && !fin) return { valeurs, retire: "" };
  return {
    valeurs: valeurs.map((v) => v.slice(debut.length, fin ? v.length - fin.length : undefined).trim()),
    retire: [debut, fin].filter(Boolean).join(" … "),
  };
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Mots-clés reconnus dans les titres de colonnes (le premier titre qui correspond l'emporte)
const COLONNES: Record<keyof Omit<LigneTableau, "duree" | "plan_continu">, string[]> = {
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
const IGNORER = ["inventoriee", "officielle", "existante", "geste original", "continu"];

// Les valeurs « à définir », « à mesurer »… ne sont pas des informations
const vide = (v: string) => /^(a definir|a mesurer|a verifier|non verifie)/.test(norm(v));

function convertir(lignes: string[][], personnage: string): { plans: LigneTableau[]; reconnues: string[]; retire: string[] } {
  const [entetes = [], ...toutes] = lignes;
  // La ligne d'exemple du fichier à remplir n'est pas un plan
  const corps = toutes.filter((l) => !norm(l[0] ?? "").startsWith("exemple"));
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
  // Lignes de 5 s qui forment un seul plan à l'écran (même numéro = même photo de départ)
  const continu = titres.findIndex((t) => t === "plan continu");
  const lire = (l: string[], i?: number) => {
    const v = i === undefined || i < 0 ? "" : (l[i] ?? "").trim();
    return vide(v) ? "" : v;
  };
  // Le fichier à remplir du studio a des prompts déjà structurés (« Static camera. 0-1s: … ») : rien n'y est retiré.
  // Pour les autres tableaux, les règles générales recopiées dans chaque cellule sont enlevées.
  const standard = titres.includes("prompt image") || titres.includes("prompt video");
  const garder = (valeurs: string[]) => (standard ? { valeurs, retire: "" } : retirerCommun(valeurs));
  const descriptions = garder(corps.map((l) => [lire(l, index.description), lire(l, action)].filter(Boolean).join(", ")));
  const mouvements = garder(corps.map((l) => lire(l, index.mouvement)));
  const cite = (t: string) => !personnage || norm(t).split(" ").includes(norm(personnage));
  const plans = corps.map((l, k) => {
    const morceaux = descriptions.valeurs[k];
    return {
      voix: lire(l, index.voix),
      mouvement: mouvements.valeurs[k],
      description: morceaux ? `${cite(morceaux) ? "" : `${personnage}, `}${morceaux}` : "",
      cadrage: lire(l, index.cadrage),
      angle: lire(l, index.angle),
      lieu: lire(l, index.lieu),
      intention: lire(l, index.intention),
      pose_debut: lire(l, index.pose_debut),
      pose_fin: lire(l, index.pose_fin),
      duree: Number(lire(l, duree).replace(",", ".")) || null,
      plan_continu: Number.parseInt(lire(l, continu), 10) || null,
    };
  });
  return {
    plans: plans.filter((p) => p.voix || p.description || p.mouvement),
    reconnues,
    retire: [descriptions.retire, mouvements.retire].filter(Boolean),
  };
}

export function ImportTableau({ projectId, personnageParDefaut = "" }: { projectId: string; personnageParDefaut?: string }) {
  const [texte, setTexte] = useState("");
  const [personnage, setPersonnage] = useState(personnageParDefaut);
  const [accord, setAccord] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const { plans, reconnues, retire } = useMemo(
    () =>
      texte
        ? convertir(/^##\s+SC[ÈE]NE\s/im.test(texte) ? lireScenario(texte) : lireCsv(texte), personnage.trim())
        : { plans: [], reconnues: [], retire: [] },
    [texte, personnage],
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-sourdine">
        Le fichier rempli par ChatGPT, ou un autre tableau en CSV : une ligne par plan.
        Colonnes reconnues : voix ou dialogue, mouvement, description, action, cadrage, angle, lieu ou décor, intention, pose
        de début et de fin, durée. Un scénario Markdown « ## SCÈNE 01 … » est aussi accepté.
      </p>
      <input
        type="file"
        accept=".csv,.md,.txt,text/csv,text/markdown,text/plain"
        className="text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          setTexte(f ? await f.text() : "");
        }}
      />
      <div>
        <label className="etiquette" htmlFor="personnage-tableau">
          Personnage ajouté aux descriptions qui ne citent personne (nom d'une photo de référence)
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
          {retire.map((r) => (
            <p key={r} className="mt-2 text-xs text-alerte">
              Texte identique dans tous les prompts, retiré (le studio l'ajoute déjà ; reprenez ce qui manque dans « Style du
              film ») : « {r.slice(0, 220)}
              {r.length > 220 ? "…" : ""} »
            </p>
          ))}
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
