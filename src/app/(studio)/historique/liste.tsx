import Link from "next/link";
import { FriseTravail } from "@/components/frise-travail";
import { getClient } from "@/lib/session";
import { CHAMPS_TRAVAIL, type Travail } from "@/lib/travaux";
import { LIBELLES_ETAPES, LIBELLES_TYPES, dureeLisible, estFinale, type Etape } from "@/lib/travaux-etapes";

// Historique de tout ce qui passe par un serveur (voix, découpe, Whisper, photos, vidéos, lip-sync) et de la vie des
// serveurs (arrêt, redémarrage, nouvelle image). Filtres par projet, type, statut et date, dans l'adresse de la page.
type Filtres = { projet?: string; type?: string; statut?: string; depuis?: string; jusqua?: string };

const STATUTS = ["en_cours", "termine", "echoue", "annule"] as const;
const LIBELLES_STATUTS: Record<string, string> = { en_cours: "En cours", termine: "Terminé", echoue: "Échoué", annule: "Annulé" };

export async function ListeHistorique({ filtres, base, projetFixe }: { filtres: Filtres; base: string; projetFixe?: string }) {
  const supabase = await getClient();
  const projet = projetFixe ?? filtres.projet;
  let requete = supabase
    .from("travaux_serveur")
    .select(`${CHAMPS_TRAVAIL}, projects(title), profiles!travaux_serveur_created_by_fkey(display_name)`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (projet) requete = requete.or(`project_id.eq.${projet},project_id.is.null`);
  if (filtres.type) requete = requete.eq("type", filtres.type);
  if (filtres.statut === "en_cours") requete = requete.not("statut", "in", "(termine,echoue,annule)");
  else if (filtres.statut) requete = requete.eq("statut", filtres.statut);
  if (filtres.depuis) requete = requete.gte("created_at", `${filtres.depuis}T00:00:00`);
  if (filtres.jusqua) requete = requete.lte("created_at", `${filtres.jusqua}T23:59:59`);
  const [{ data, error }, { data: projets }] = await Promise.all([
    requete,
    projetFixe ? Promise.resolve({ data: [] }) : supabase.from("projects").select("id, title").order("created_at", { ascending: false }).limit(100),
  ]);
  if (error)
    return (
      <p className="message-erreur">
        L&apos;historique n&apos;est pas encore prêt : appliquez la migration <code>0020_travaux_serveur.sql</code> dans Supabase.
      </p>
    );
  type Ligne = Travail & { projects?: { title: string } | null; profiles?: { display_name: string } | null };
  const lignes = (data ?? []) as unknown as Ligne[];
  const cout = lignes.reduce((n, t) => n + Number(t.cout_usd ?? 0), 0);
  const duree = (t: Ligne) => ((t.fini_at ? new Date(t.fini_at).getTime() : Date.now()) - new Date(t.created_at).getTime()) / 1000;

  return (
    <div className="flex flex-col gap-4">
      <form className="carte flex flex-wrap items-end gap-3 text-sm" action={base}>
        {!projetFixe && (
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0">Projet</span>
            <select name="projet" defaultValue={filtres.projet ?? ""} className="champ">
              <option value="">Tous</option>
              {(projets ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="etiquette mb-0">Type</span>
          <select name="type" defaultValue={filtres.type ?? ""} className="champ">
            <option value="">Tous</option>
            {Object.entries(LIBELLES_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="etiquette mb-0">Statut</span>
          <select name="statut" defaultValue={filtres.statut ?? ""} className="champ">
            <option value="">Tous</option>
            {STATUTS.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUTS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="etiquette mb-0">Du</span>
          <input type="date" name="depuis" defaultValue={filtres.depuis ?? ""} className="champ" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="etiquette mb-0">Au</span>
          <input type="date" name="jusqua" defaultValue={filtres.jusqua ?? ""} className="champ" />
        </label>
        <button className="bouton-discret">Filtrer</button>
        <Link href={base} className="lien">
          Tout afficher
        </Link>
      </form>
      <p className="text-sm text-sourdine">
        {lignes.length} travail{lignes.length > 1 ? "x" : ""}
        {lignes.length === 200 ? " (les 200 plus récents)" : ""} · {cout.toFixed(2)} $ au total
      </p>
      {lignes.length === 0 ? (
        <p className="carte text-sm text-sourdine">Rien pour ces filtres.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lignes.map((t) => (
            <li key={t.id} className="carte p-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-sourdine">
                    {new Date(t.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })}
                  </span>
                  <b>{LIBELLES_TYPES[t.type] ?? t.type}</b>
                  <span
                    className={`pastille ${t.statut === "echoue" ? "bg-alerte text-surface" : t.statut === "termine" ? "bg-succes-doux text-succes" : t.statut === "annule" ? "bg-surface-2 text-sourdine" : "bg-accent-doux text-accent"}`}
                  >
                    {estFinale(t.statut) ? LIBELLES_ETAPES[t.statut as Etape] : `⏳ ${LIBELLES_ETAPES[t.statut as Etape] ?? t.statut}${t.progression !== null ? ` ${t.progression} %` : ""}`}
                  </span>
                  {!projetFixe && <span>{t.projects?.title ?? "Toute l'équipe"}</span>}
                  <span className="text-sourdine">{dureeLisible(duree(t))}</span>
                  {t.cout_usd !== null && <span className="text-sourdine">{Number(t.cout_usd).toFixed(3)} $</span>}
                  <span className="text-sourdine">{t.profiles?.display_name || ""}</span>
                  {t.erreur && <span className="text-alerte">{t.erreur}</span>}
                  {!t.runpod_job_id && t.message && <span className="text-sourdine">{t.message}</span>}
                </summary>
                {t.runpod_job_id && (
                  <div className="mt-2">
                    <FriseTravail jobId={t.runpod_job_id} />
                  </div>
                )}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
