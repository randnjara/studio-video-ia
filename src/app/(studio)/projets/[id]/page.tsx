import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { FORMATS, GENRES, LIBELLES_FORMAT, STATUTS_MONTAGE, dureeLisible } from "@/lib/libelles";
import { signerLiens } from "@/lib/production";
import { getClient, requireProfile } from "@/lib/session";
import { enregistrerProjet, mettreALaCorbeille } from "./actions";
import { supprimerReference } from "./plans/actions";
import { AjoutReference } from "./plans/references";

type Evenement = { date: string; texte: string; lien?: string };

const LIBELLE_ESSAI: Record<string, string> = {
  en_cours: "envoyé à la génération",
  terminee: "clip prêt à valider",
  echouee: "génération échouée (non facturée)",
  annulee: "génération annulée",
  en_attente: "en attente",
};

// Étape 1 : les informations du projet (dont la voix off, le résumé et les références du film), l'avancement et l'historique
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

  const [
    { profile },
    { data: projet },
    { data: espaces },
    { data: scenes },
    { data: essais },
    { data: montages },
    { data: versions },
    { data: refsLues },
  ] =
    await Promise.all([
      requireProfile(),
      supabase
        .from("projects")
        .select("id, title, client_name, aspect_ratio, due_date, workspace_id, created_at, resume, scenario_text, style_text")
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
      supabase.from("film_refs").select("id, nom, genre, description, image_path").eq("project_id", id).order("created_at"),
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
  const refs = refsLues ?? [];
  const liens = await signerLiens(supabase, refs.map((r) => r.image_path));
  const sansPersonnage = !refs.some((r) => r.genre === "personnage");

  // Ce qu'il faut faire maintenant
  const base = `/projets/${id}`;
  const suite =
    plans.length === 0 && sansPersonnage
      ? { texte: "Remplissez les informations ci-dessous et ajoutez la photo du personnage principal.", lien: "#references", bouton: "Ajouter la photo" }
      : plans.length === 0
        ? { texte: "Préparez le tableau des plans avec ChatGPT, puis importez-le.", lien: `${base}/chatgpt`, bouton: "Étape 2 : ChatGPT" }
        : sansPhoto > 0
        ? { texte: `${sansPhoto} plan(s) sans photo à compléter.`, lien: `${base}/plans`, bouton: "Compléter les plans" }
        : aValider > 0
          ? { texte: `${aValider} plan(s) ont des clips à regarder et valider.`, lien: `${base}/clips`, bouton: "Valider les clips" }
          : valides < plans.length
            ? { texte: "Envoyez les plans restants à la génération vidéo.", lien: `${base}/plans`, bouton: "Envoyer à la génération" }
            : { texte: "Tous les plans ont un clip validé : assemblez-les.", lien: `${base}/montage`, bouton: "Faire le montage" };

  const historique: Evenement[] = [
    { date: projet.created_at, texte: "Projet créé" },
    ...(versions ?? []).map((v) => ({ date: v.created_at, texte: "Voix off enregistrée", lien: `${base}#voix-off` })),
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
        {sp.reference && <p className="message-ok">Référence ajoutée.</p>}
        {sp.erreur === "reference" && (
          <p className="message-erreur">La référence n'a pas pu être ajoutée : donnez-lui un nom et une photo.</p>
        )}
        {sp.erreur && sp.erreur !== "reference" && (
          <p className="message-erreur">L'enregistrement a échoué. Réessayez dans un instant.</p>
        )}

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

        <form id="infos-projet" action={enregistrerProjet.bind(null, id)} className="carte grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-bold sm:col-span-2">1. Informations du film</h2>
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
          <div className="sm:col-span-2">
            <label htmlFor="resume" className="etiquette">
              Résumé ou but du film (facultatif, quelques phrases)
            </label>
            <textarea
              id="resume"
              name="resume"
              rows={3}
              maxLength={5000}
              defaultValue={projet.resume}
              placeholder="Ex. : Une grand-mère parle avec tendresse à ses petits-enfants partis loin. Film d'environ 5 minutes."
              className="champ text-sm"
            />
          </div>
          <div className="sm:col-span-2" id="voix-off">
            <label htmlFor="scenario_text" className="etiquette">
              Voix off du film (texte, dans sa langue d'origine)
            </label>
            <textarea
              id="scenario_text"
              name="scenario_text"
              rows={8}
              defaultValue={projet.scenario_text}
              placeholder="Collez ici tout le texte dit dans le film. ChatGPT le découpera en plans à l'étape 2."
              className="champ text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="style_text" className="etiquette">
              Style du film (facultatif, ajouté à chaque photo ; ChatGPT peut le proposer)
            </label>
            <textarea
              id="style_text"
              name="style_text"
              rows={2}
              maxLength={600}
              defaultValue={projet.style_text}
              placeholder="Ex. : Madagascar années 1990, lumière chaude de fin de journée, couleurs douces, caméra 35 mm"
              className="champ text-sm"
            />
          </div>
        </form>

        {/* Références du film : les photos de départ sont créées à partir d'elles, avec les mêmes visages et décors */}
        <section className="carte flex scroll-mt-4 flex-col gap-4" id="references">
          <div>
            <h2 className="text-lg font-bold">Photos de référence</h2>
            <p className="text-sm text-sourdine">
              Indispensable : la photo du personnage principal, avec son nom. Facultatif : une photo par autre personnage, lieu ou
              objet important. Le studio garde ainsi les mêmes visages, vêtements et décors sur tous les plans.
            </p>
          </div>
          {sansPersonnage && (
            <p className="text-sm text-alerte">Ajoutez la photo du personnage principal (type « Personnage »).</p>
          )}
          {refs.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {refs.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={liens.get(r.image_path)}
                    alt={r.nom}
                    className="aspect-square w-full rounded-lg border border-ligne object-cover"
                  />
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.nom}</span>
                    <form action={supprimerReference.bind(null, id, r.id)}>
                      <BoutonEnvoi className="lien text-xs" enCours="…" confirmer={`Retirer la référence « ${r.nom} » ?`}>
                        Retirer
                      </BoutonEnvoi>
                    </form>
                  </div>
                  <span className="text-xs text-sourdine">
                    {GENRES[r.genre] ?? r.genre}
                    {r.description ? ` · ${r.description}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <details className="rounded-lg border border-ligne p-4" open={refs.length === 0}>
            <summary className="cursor-pointer font-semibold">＋ Ajouter une photo de référence</summary>
            <div className="mt-4">
              <AjoutReference projectId={id} />
            </div>
          </details>
        </section>

        {/* Le bouton enregistre le formulaire des informations (plus haut) puis ouvre l'étape 2 */}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" form="infos-projet" className="bouton">
            ✓ Valider les informations → Étape 2 : ChatGPT
          </button>
          {sansPersonnage && <span className="text-sm text-sourdine">Pensez d'abord à la photo du personnage principal.</span>}
        </div>
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
