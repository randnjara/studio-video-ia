import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { FORMATS, STATUTS_PROJET, dateCourte } from "@/lib/libelles";
import { creerProjet } from "./actions";

type Espace = { id: string; name: string; kind: "personnel" | "equipe"; owner_id: string | null };
type Projet = {
  id: string;
  title: string;
  client_name: string | null;
  status: string;
  aspect_ratio: string;
  workspace_id: string;
  updated_at: string;
};

const ERREURS: Record<string, string> = {
  "projet-incomplet": "Donnez un titre au projet et choisissez un espace.",
  "projet-refuse": "Le projet n'a pas pu être créé. Réessayez dans un instant.",
};

export default async function Accueil({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  const { supabase, profile } = await requireProfile();

  const [{ data: espacesBruts }, { data: projets }] = await Promise.all([
    supabase.from("workspaces").select("id, name, kind, owner_id"),
    supabase
      .from("projects")
      .select("id, title, client_name, status, aspect_ratio, workspace_id, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
  ]);

  // Mon espace personnel d'abord, puis l'espace d'équipe
  const espaces = ((espacesBruts ?? []) as Espace[])
    .filter((e) => e.kind === "equipe" || e.owner_id === profile.id)
    .sort((a, b) => (a.kind === "personnel" ? -1 : 1) - (b.kind === "personnel" ? -1 : 1));

  return (
    <div className="flex flex-col gap-8">
      <section className="carte">
        <h1 className="text-xl font-bold">Nouveau projet</h1>
        <form action={creerProjet} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="title" className="etiquette">
              Titre
            </label>
            <input id="title" name="title" required className="champ" placeholder="Pub Hôtel Anjary, 2 min" />
          </div>
          <div>
            <label htmlFor="client_name" className="etiquette">
              Client
            </label>
            <input id="client_name" name="client_name" className="champ" />
          </div>
          <div>
            <label htmlFor="aspect_ratio" className="etiquette">
              Format
            </label>
            <select id="aspect_ratio" name="aspect_ratio" className="champ" defaultValue="9:16">
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f === "9:16" ? "9:16 vertical (Facebook, TikTok)" : f === "16:9" ? "16:9 horizontal" : "1:1 carré"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="workspace_id" className="etiquette">
              Espace
            </label>
            <select id="workspace_id" name="workspace_id" className="champ">
              {espaces.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind === "personnel" ? "Mon espace" : "Équipe (partagé)"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="bouton w-full sm:w-auto">
              Créer le projet
            </button>
          </div>
          {erreur && ERREURS[erreur] && <p className="text-sm text-alerte sm:col-span-2">{ERREURS[erreur]}</p>}
        </form>
      </section>

      {espaces.map((espace) => {
        const liste = ((projets ?? []) as Projet[]).filter((p) => p.workspace_id === espace.id);
        return (
          <section key={espace.id} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">
              {espace.kind === "personnel" ? "Mon espace" : "Espace équipe"}{" "}
              <span className="font-normal text-sourdine">({liste.length})</span>
            </h2>
            {liste.length === 0 ? (
              <p className="text-sourdine">
                Aucun projet ici pour l'instant. Créez-en un avec le formulaire ci-dessus.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {liste.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projets/${p.id}`} className="carte block hover:border-accent">
                      <p className="font-semibold">{p.title}</p>
                      <p className="mt-1 text-sm text-sourdine">
                        {[p.client_name, p.aspect_ratio, STATUTS_PROJET[p.status]].filter(Boolean).join(" · ")}
                      </p>
                      <p className="mt-1 text-xs text-sourdine">Modifié le {dateCourte(p.updated_at)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
