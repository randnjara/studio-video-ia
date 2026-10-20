import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/session";
import { FORMATS, STATUTS_PROJET, dateCourte } from "@/lib/libelles";
import { enregistrerProjet, mettreALaCorbeille, restaurerScenario } from "./actions";

type Version = { id: number; created_at: string; data: { scenario_text?: string } };

export default async function PageProjet({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ enregistre?: string; restaure?: string; erreur?: string }>;
}) {
  const { id } = await params;
  const { enregistre, restaure, erreur } = await searchParams;
  const { supabase, profile } = await requireProfile();

  const { data: projet } = await supabase
    .from("projects")
    .select("id, title, client_name, aspect_ratio, due_date, status, scenario_text, workspace_id, updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!projet) notFound();

  const [{ data: espaces }, { data: versions }] = await Promise.all([
    supabase.from("workspaces").select("id, kind, owner_id"),
    supabase
      .from("project_versions")
      .select("id, created_at, data")
      .eq("project_id", id)
      .eq("kind", "scenario")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const espacesVisibles = (espaces ?? []).filter((e) => e.kind === "equipe" || e.owner_id === profile.id);

  const enregistrer = enregistrerProjet.bind(null, id);
  const corbeille = mettreALaCorbeille.bind(null, id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm font-semibold text-accent hover:underline">
          ← Tous les projets
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{projet.title}</h1>
        <p className="text-sourdine">
          {STATUTS_PROJET[projet.status]} · modifié le {dateCourte(projet.updated_at)}
        </p>
      </div>

      {enregistre && <p className="rounded-md bg-accent-doux px-4 py-2 text-sm">Projet enregistré.</p>}
      {restaure && <p className="rounded-md bg-accent-doux px-4 py-2 text-sm">Ancienne version du scénario restaurée.</p>}
      {erreur && <p className="text-sm text-alerte">L'enregistrement a échoué. Réessayez dans un instant.</p>}

      <form action={enregistrer} className="carte grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="title" className="etiquette">
            Titre
          </label>
          <input id="title" name="title" defaultValue={projet.title} required className="champ" />
        </div>
        <div>
          <label htmlFor="client_name" className="etiquette">
            Client
          </label>
          <input id="client_name" name="client_name" defaultValue={projet.client_name ?? ""} className="champ" />
        </div>
        <div>
          <label htmlFor="due_date" className="etiquette">
            Date de livraison
          </label>
          <input id="due_date" name="due_date" type="date" defaultValue={projet.due_date ?? ""} className="champ" />
        </div>
        <div>
          <label htmlFor="aspect_ratio" className="etiquette">
            Format
          </label>
          <select id="aspect_ratio" name="aspect_ratio" defaultValue={projet.aspect_ratio} className="champ">
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="workspace_id" className="etiquette">
            Espace
          </label>
          <select id="workspace_id" name="workspace_id" defaultValue={projet.workspace_id} className="champ">
            {espacesVisibles.map((e) => (
              <option key={e.id} value={e.id}>
                {e.kind === "personnel" ? "Mon espace" : "Équipe (partagé)"}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="scenario_text" className="etiquette">
            Scénario
          </label>
          <p className="mb-2 text-sm text-sourdine">
            Collez ici le scénario et le texte de la voix off. Le découpage automatique en scènes arrive à l'étape 4.
          </p>
          <textarea
            id="scenario_text"
            name="scenario_text"
            rows={14}
            defaultValue={projet.scenario_text}
            className="champ font-mono text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" className="bouton">
            Enregistrer
          </button>
        </div>
      </form>

      {versions && versions.length > 0 && (
        <section className="carte">
          <h2 className="font-bold">Versions précédentes du scénario</h2>
          <ul className="mt-3 divide-y divide-ligne">
            {(versions as Version[]).map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="text-sourdine">
                  {new Date(v.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <span className="min-w-0 flex-1 truncate">{v.data.scenario_text?.slice(0, 80) || "(vide)"}</span>
                <form action={restaurerScenario.bind(null, id, v.id)}>
                  <button type="submit" className="font-semibold text-accent hover:underline">
                    Restaurer
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={corbeille}>
        <button type="submit" className="text-sm font-semibold text-alerte hover:underline">
          Mettre le projet à la corbeille
        </button>
      </form>
    </div>
  );
}
