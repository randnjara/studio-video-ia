import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { FORMATS, LIBELLES_FORMAT, STATUTS_MONTAGE, dureeLisible } from "@/lib/libelles";
import { getClient, requireProfile } from "@/lib/session";
import { enregistrerProjet, mettreALaCorbeille } from "./actions";

type Evenement = { date: string; texte: string; lien?: string };

const LIBELLE_ESSAI: Record<string, string> = {
  en_cours: "envoyé à la génération",
  terminee: "clip prêt à valider",
  echouee: "génération échouée (non facturée)",
  annulee: "génération annulée",
  en_attente: "en attente",
};

// Étape 1 : les informations du projet, le résumé de l'avancement et l'historique
export default async function PageProjet({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await getClient();

  const [{ profile }, { data: projet }, { data: espaces }, { data: scenes }, { data: essais }, { data: montages }, { data: versions }] =
    await Promise.all([
      requireProfile(),
      supabase
        .from("projects")
        .select("id, title, client_name, aspect_ratio, due_date, workspace_id, created_at")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("workspaces").select("id, kind, owner_id"),
      supabase.from("scenes").select("id, position, status, image_path, duration_s").eq("project_id", id).order("position"),
      supabase
        .from("takes")
        .select("id, status, cost_usd, created_at, finished_at, scene_id, scenes!takes_scene_id_fkey!inner(project_id)")
        .eq("scenes.project_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("montages").select("id, title, status, created_at, updated_at").eq("project_id", id),
      supabase
        .from("project_versions")
        .select("id, created_at")
        .eq("project_id", id)
        .eq("kind", "scenario")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
  if (!projet) return null; // le cadre du projet affiche déjà « introuvable »

  const plans = scenes ?? [];
  const numero = new Map(plans.map((p, i) => [p.id, i + 1]));
  const valides = plans.filter((p) => p.status === "validee").length;
  const aValider = plans.filter((p) => p.status === "a_valider").length;
  const sansPhoto = plans.filter((p) => !p.image_path).length;
  const duree = plans.reduce((n, p) => n + Number(p.duration_s || 5), 0);
  const cout = (essais ?? []).reduce((n, t) => n + Number(t.cost_usd ?? 0), 0);
  const espacesVisibles = (espaces ?? []).filter((e) => e.kind === "equipe" || e.owner_id === profile.id);

  // Ce qu'il faut faire maintenant
  const base = `/projets/${id}`;
  const suite =
    plans.length === 0
      ? { texte: "Créez les plans : une photo + un mouvement par plan, ou tout le script et les photos d'un coup.", lien: `${base}/plans`, bouton: "Créer les plans" }
      : sansPhoto > 0
        ? { texte: `${sansPhoto} plan(s) sans photo à compléter.`, lien: `${base}/plans`, bouton: "Compléter les plans" }
        : aValider > 0
          ? { texte: `${aValider} plan(s) ont des clips à regarder et valider.`, lien: `${base}/clips`, bouton: "Valider les clips" }
          : valides < plans.length
            ? { texte: "Envoyez les plans restants à la génération vidéo.", lien: `${base}/plans`, bouton: "Envoyer à la génération" }
            : { texte: "Tous les plans ont un clip validé : assemblez-les.", lien: `${base}/montage`, bouton: "Faire le montage" };

  const historique: Evenement[] = [
    { date: projet.created_at, texte: "Projet créé" },
    ...(versions ?? []).map((v) => ({ date: v.created_at, texte: "Script enregistré", lien: `${base}/plans#script` })),
    ...(essais ?? []).map((t) => ({
      date: t.finished_at ?? t.created_at,
      texte: `Plan ${numero.get(t.scene_id) ?? "?"} : ${LIBELLE_ESSAI[t.status] ?? t.status}`,
      lien: `${base}/clips#plan-${t.scene_id}`,
    })),
    ...(montages ?? []).map((m) => ({
      date: m.updated_at,
      texte: `Montage « ${m.title} » : ${STATUTS_MONTAGE[m.status]?.toLowerCase()}`,
      lien: `${base}/montage#montage-${m.id}`,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        {sp.enregistre && <p className="message-ok">Informations enregistrées.</p>}
        {sp.erreur && <p className="message-erreur">L'enregistrement a échoué. Réessayez dans un instant.</p>}

        <section className="carte flex flex-wrap items-center gap-4 border-accent/40">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-accent">Prochaine étape</p>
            <p className="mt-1">{suite.texte}</p>
          </div>
          <Link href={suite.lien} className="bouton">
            {suite.bouton} →
          </Link>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { valeur: plans.length, libelle: "plans" },
            { valeur: dureeLisible(duree), libelle: "de vidéo prévue" },
            { valeur: `${valides} / ${plans.length}`, libelle: "clips validés" },
            { valeur: `${cout.toFixed(2)} $`, libelle: "dépensés en GPU" },
          ].map((c) => (
            <div key={c.libelle} className="carte p-4">
              <p className="text-xl font-bold">{c.valeur}</p>
              <p className="text-xs text-sourdine">{c.libelle}</p>
            </div>
          ))}
        </section>

        <form action={enregistrerProjet.bind(null, id)} className="carte grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-bold sm:col-span-2">Informations</h2>
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
              Format des vidéos
            </label>
            <select id="aspect_ratio" name="aspect_ratio" defaultValue={projet.aspect_ratio} className="champ">
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
            <select id="workspace_id" name="workspace_id" defaultValue={projet.workspace_id} className="champ">
              {espacesVisibles.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind === "personnel" ? "Mon espace (privé)" : "Équipe (partagé)"}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-sourdine sm:col-span-2">
            Le script et les plans se gèrent dans l'étape{" "}
            <Link href={`${base}/plans`} className="lien">
              Plans
            </Link>
            .
          </p>
          <div className="sm:col-span-2">
            <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
          </div>
        </form>
      </div>

      <div className="flex flex-col gap-6">
        <section className="carte">
          <h2 className="font-bold">Historique</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {historique.map((e, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0">
                  {e.lien ? (
                    <Link href={e.lien} className="hover:underline">
                      {e.texte}
                    </Link>
                  ) : (
                    e.texte
                  )}
                  <span className="block text-xs text-sourdine">
                    {new Date(e.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <form action={mettreALaCorbeille.bind(null, id)} className="carte">
          <h2 className="font-bold">Supprimer le projet</h2>
          <p className="mt-1 mb-3 text-sm text-sourdine">Il part à la corbeille et peut être restauré depuis la liste des projets.</p>
          <BoutonEnvoi className="bouton-danger" enCours="…" confirmer={`Mettre « ${projet.title} » à la corbeille ?`}>
            Mettre à la corbeille
          </BoutonEnvoi>
        </form>
      </div>
    </div>
  );
}
