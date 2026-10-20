import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { requireProfile } from "@/lib/session";
import { FORMATS, LIBELLES_FORMAT, STATUTS_PROJET, couleurStatut, dateCourte } from "@/lib/libelles";
import { creerProjet, restaurerProjet, supprimerProjet, viderCorbeille } from "./actions";

type Espace = { id: string; name: string; kind: "personnel" | "equipe"; owner_id: string | null };
type Projet = {
  id: string;
  title: string;
  client_name: string | null;
  status: string;
  aspect_ratio: string;
  workspace_id: string;
  updated_at: string;
  deleted_at: string | null;
  scenes: { count: number }[];
};

const ERREURS: Record<string, string> = {
  "projet-incomplet": "Donnez un titre au projet et choisissez un espace.",
  "projet-refuse": "Le projet n'a pas pu être créé. Réessayez dans un instant.",
};

export default async function Accueil({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; corbeille?: string; supprime?: string; vide?: string }>;
}) {
  const { erreur, corbeille, supprime, vide } = await searchParams;
  const { supabase, profile } = await requireProfile();

  const [{ data: espacesBruts }, { data: projetsBruts }] = await Promise.all([
    supabase.from("workspaces").select("id, name, kind, owner_id"),
    supabase
      .from("projects")
      .select("id, title, client_name, status, aspect_ratio, workspace_id, updated_at, deleted_at, scenes(count)")
      .order("updated_at", { ascending: false }),
  ]);

  // Mon espace personnel d'abord, puis l'espace d'équipe
  const espaces = ((espacesBruts ?? []) as Espace[])
    .filter((e) => e.kind === "equipe" || e.owner_id === profile.id)
    .sort((a, b) => (a.kind === "personnel" ? -1 : 1) - (b.kind === "personnel" ? -1 : 1));
  const tous = (projetsBruts ?? []) as Projet[];
  const projets = tous.filter((p) => !p.deleted_at);
  const supprimes = tous.filter((p) => p.deleted_at);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projets</h1>
          <p className="text-sourdine">
            {projets.length} projet{projets.length > 1 ? "s" : ""} en cours
          </p>
        </div>
      </div>

      {supprime && <p className="message-ok">Projet mis à la corbeille. Vous pouvez le restaurer en bas de la page.</p>}
      {vide && <p className="message-ok">Corbeille vidée.</p>}
      {erreur && ERREURS[erreur] && <p className="message-erreur">{ERREURS[erreur]}</p>}

      <details className="carte group" open={projets.length === 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-texte">+</span>
          Nouveau projet
        </summary>
        <form action={creerProjet} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="title" className="etiquette">
              Titre
            </label>
            <input id="title" name="title" required className="champ" placeholder="Pub Hôtel Anjary" />
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
                  {LIBELLES_FORMAT[f]}
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
                  {e.kind === "personnel" ? "Mon espace (privé)" : "Équipe (partagé)"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <BoutonEnvoi enCours="Création…" className="bouton w-full sm:w-auto">
              Créer le projet
            </BoutonEnvoi>
          </div>
        </form>
      </details>

      {espaces.map((espace) => {
        const liste = projets.filter((p) => p.workspace_id === espace.id);
        return (
          <section key={espace.id} className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">
              {espace.kind === "personnel" ? "Mon espace" : "Espace équipe"}{" "}
              <span className="font-normal text-sourdine">({liste.length})</span>
            </h2>
            {liste.length === 0 ? (
              <p className="text-sourdine">Aucun projet ici pour l'instant.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {liste.map((p) => (
                  <li key={p.id} className="carte flex flex-col gap-3 transition hover:border-accent">
                    <Link href={`/projets/${p.id}`} className="flex flex-col gap-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{p.title}</span>
                        <span className={`pastille shrink-0 ${couleurStatut(p.status)}`}>{STATUTS_PROJET[p.status]}</span>
                      </span>
                      <span className="text-sm text-sourdine">
                        {[p.client_name, p.aspect_ratio, `${p.scenes?.[0]?.count ?? 0} plans`].filter(Boolean).join(" · ")}
                      </span>
                      <span className="text-xs text-sourdine">Modifié le {dateCourte(p.updated_at)}</span>
                    </Link>
                    <div className="mt-auto flex items-center gap-2 border-t border-ligne pt-3 text-sm">
                      <Link href={`/projets/${p.id}`} className="lien">
                        Ouvrir
                      </Link>
                      <Link href={`/projets/${p.id}/plans`} className="lien">
                        Plans
                      </Link>
                      <form action={supprimerProjet.bind(null, p.id)} className="ml-auto">
                        <BoutonEnvoi
                          className="bouton-danger px-2 py-1"
                          enCours="…"
                          confirmer={`Mettre « ${p.title} » à la corbeille ?`}
                        >
                          Supprimer
                        </BoutonEnvoi>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {supprimes.length > 0 && (
        <details className="carte" open={Boolean(corbeille)}>
          <summary className="cursor-pointer font-semibold">Corbeille ({supprimes.length})</summary>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-sourdine">Les projets de la corbeille peuvent être restaurés.</p>
            <form action={viderCorbeille}>
              <BoutonEnvoi
                className="bouton-danger"
                enCours="Suppression…"
                confirmer={`Effacer définitivement ${supprimes.length} projet(s), avec leurs plans ? C'est irréversible.`}
              >
                Vider la corbeille
              </BoutonEnvoi>
            </form>
          </div>
          <ul className="mt-3 divide-y divide-ligne">
            {supprimes.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1 truncate">{p.title}</span>
                <span className="text-sourdine">supprimé le {dateCourte(p.deleted_at)}</span>
                <form action={restaurerProjet.bind(null, p.id)}>
                  <BoutonEnvoi className="lien" enCours="…">
                    Restaurer
                  </BoutonEnvoi>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
