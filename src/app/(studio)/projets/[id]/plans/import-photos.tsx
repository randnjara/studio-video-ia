"use client";

import { unzip } from "fflate";
import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { envoyerPhoto } from "@/lib/envoi-photo";
import { attacherPhotos } from "./actions";

type PlanCourt = { id: string; numero: number; aPhoto: boolean };

// Numéro de plan lu dans le nom du fichier : « plan_03.png », « 3.jpg », « scene_03_mama.png » → 3
const numeroDuNom = (nom: string) => {
  const m = nom.replace(/\.[a-z0-9]+$/i, "").match(/\d+/);
  return m ? Number(m[0]) : null;
};

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

// Photos contenues dans un fichier ZIP (celui que ChatGPT donne à télécharger), dossiers et fichiers cachés ignorés
async function photosDuZip(zip: File): Promise<File[]> {
  const octetsZip = new Uint8Array(await zip.arrayBuffer());
  const contenu = await new Promise<Record<string, Uint8Array>>((ok, ko) => unzip(octetsZip, (e, d) => (e ? ko(e) : ok(d))));
  return Object.entries(contenu).flatMap(([chemin, octets]) => {
    const nom = chemin.split("/").pop() ?? "";
    const type = TYPES[nom.split(".").pop()?.toLowerCase() ?? ""];
    if (!type || nom.startsWith(".") || chemin.includes("__MACOSX")) return [];
    return [new File([octets.slice()], nom, { type })];
  });
}

// Associe chaque photo à un plan : par le numéro dans son nom, sinon dans l'ordre, aux plans encore sans photo
function associer(fichiers: File[], plans: PlanCourt[]) {
  const parNumero = new Map(plans.map((p) => [p.numero, p]));
  const pris = new Set<string>();
  const liens: { fichier: File; plan: PlanCourt | null }[] = [];
  const sansNumero: File[] = [];
  for (const f of [...fichiers].sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }))) {
    const n = numeroDuNom(f.name);
    const plan = n === null ? undefined : parNumero.get(n);
    if (plan && !pris.has(plan.id)) {
      pris.add(plan.id);
      liens.push({ fichier: f, plan });
    } else sansNumero.push(f);
  }
  const libres = plans.filter((p) => !p.aPhoto && !pris.has(p.id));
  for (const f of sansNumero) {
    const plan = libres.shift() ?? null;
    if (plan) pris.add(plan.id);
    liens.push({ fichier: f, plan });
  }
  return liens.sort((a, b) => (a.plan?.numero ?? 1e9) - (b.plan?.numero ?? 1e9));
}

// Import de photos de départ faites ailleurs, toutes d'un coup
export function ImportPhotos({ projectId, plans }: { projectId: string; plans: PlanCourt[] }) {
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [etape, setEtape] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const liens = useMemo(() => associer(fichiers, plans), [fichiers, plans]);
  const places = liens.filter((l) => l.plan);
  const remplacees = places.filter((l) => l.plan!.aPhoto).length;

  function envoyer() {
    setErreur(null);
    demarrer(async () => {
      try {
        const envoyees: { sceneId: string; chemin: string }[] = [];
        for (const [i, l] of places.entries()) {
          setEtape(`Envoi des photos… ${i + 1} / ${places.length}`);
          envoyees.push({ sceneId: l.plan!.id, chemin: await envoyerPhoto(projectId, l.fichier) });
        }
        setEtape("Enregistrement…");
        await attacherPhotos(projectId, envoyees);
      } catch (e) {
        unstable_rethrow(e);
        setErreur(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-sourdine">
        2. Choisissez les fichiers ZIP donnés par ChatGPT (un ou plusieurs lots à la fois), ou directement les photos. Chaque
        photo va au plan dont le numéro est dans son nom (plan_01.png, plan_02.png…) ; une photo sans numéro va au premier
        plan qui n'a pas encore de photo. Les fichiers RAR ne sont pas lus : demandez un ZIP.
      </p>
      <input
        type="file"
        accept="image/*,.zip,application/zip"
        multiple
        aria-label="Photos de départ"
        className="text-sm"
        onChange={async (e) => {
          setErreur(null);
          const choisis = [...(e.target.files ?? [])];
          try {
            const rar = choisis.filter((f) => /\.rar$/i.test(f.name));
            if (rar.length) setErreur(`${rar.map((f) => f.name).join(", ")} : format RAR non lu, demandez un fichier ZIP.`);
            const listes = await Promise.all(
              choisis.map((f) => (/\.zip$/i.test(f.name) ? photosDuZip(f) : f.type.startsWith("image/") ? [f] : [])),
            );
            setFichiers(listes.flat());
          } catch {
            setErreur("Ce fichier ZIP n'a pas pu être ouvert. Téléchargez-le de nouveau.");
            setFichiers([]);
          }
        }}
      />
      {liens.length > 0 && (
        <ul className="max-h-60 overflow-auto rounded-lg border border-ligne text-xs">
          {liens.map((l) => (
            <li key={l.fichier.name} className="flex gap-2 border-b border-ligne px-3 py-1.5 last:border-0">
              <span className="min-w-0 flex-1 truncate">{l.fichier.name}</span>
              {l.plan ? (
                <span className={l.plan.aPhoto ? "text-alerte" : "text-succes"}>
                  → Plan {l.plan.numero}
                  {l.plan.aPhoto ? " (remplace sa photo)" : ""}
                </span>
              ) : (
                <span className="text-sourdine">ignorée : aucun plan libre</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {erreur && <p className="message-erreur">{erreur}</p>}
      <div>
        <button type="button" className="bouton" disabled={enCours || places.length === 0} onClick={envoyer}>
          {enCours && <Roue />}
          {enCours
            ? etape
            : `📥 Importer ${places.length} photo${places.length > 1 ? "s" : ""}${remplacees ? ` (${remplacees} remplacée${remplacees > 1 ? "s" : ""})` : ""}`}
        </button>
      </div>
    </div>
  );
}
