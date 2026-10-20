import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { requireProfile } from "@/lib/session";
import {
  FORMATS,
  LIBELLES_FORMAT,
  STATUTS_PLAN,
  STATUTS_PROJET,
  couleurStatut,
  dateCourte,
  dureeLisible,
} from "@/lib/libelles";
import { enregistrerProjet, mettreALaCorbeille, restaurerScenario, validerScenario } from "./actions";

type Version = { id: number; created_at: string; data: { scenario_text?: string } };
type Plan = {
  id: string;
  position: number;
  image_path: string | null;
  voiceover_text: string;
  duration_s: number;
  status: string;
  validated_take_id: string | null;
  takes: { id: string; video_path: string | null }[];
};

const MESSAGES: Record<string, string> = {
  enregistre: "Projet enregistré.",
  restaure: "Ancienne version du scénario restaurée.",
  "scenario-valide": "Scénario validé. Place aux plans et aux vidéos.",
  "scenario-rouvert": "Scénario rouvert : vous pouvez le modifier.",
};

export default async function PageProjet({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await requireProfile();

  const [{ data: projet }, { data: espaces }, { data: versions }, { data: plansBruts }] = await Promise.all([
    supabase
      .from("projects")
      .select(
        "id, title, client_name, aspect_ratio, due_date, status, scenario_text, scenario_validated_at, workspace_id, updated_at",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .single(),
    supabase.from("workspaces").select("id, kind, owner_id"),
    supabase
      .from("project_versions")
      .select("id, created_at, data")
      .eq("project_id", id)
      .eq("kind", "scenario")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("scenes")
      .select("id, position, image_path, voiceover_text, duration_s, status, validated_take_id, takes(id, video_path)")
      .eq("project_id", id)
      .order("position"),
  ]);
  if (!projet) notFound();

  const plans = (plansBruts ?? []) as Plan[];
  const espacesVisibles = (espaces ?? []).filter((e) => e.kind === "equipe" || e.owner_id === profile.id);
  const valides = plans.filter((p) => p.status === "validee" && p.validated_take_id);
  const dureeMontage = valides.reduce((n, p) => n + Number(p.duration_s || 5), 0);

  // Miniatures et vidéos validées (liens temporaires d'une heure)
  const chemins = [
    ...plans.flatMap((p) => (p.image_path ? [p.image_path] : [])),
    ...valides.flatMap((p) => p.takes.filter((t) => t.id === p.validated_take_id && t.video_path).map((t) => t.video_path!)),
  ];
  const liens = new Map<string, string>();
  if (chemins.length > 0) {
    const { data: signes } = await supabase.storage.from("medias").createSignedUrls(chemins, 60 * 60);
    for (const s of signes ?? []) if (s.path && s.signedUrl) liens.set(s.path, s.signedUrl);
  }

  const message = Object.keys(MESSAGES).find((k) => sp[k]);
  const scenarioValide = Boolean(projet.scenario_validated_at);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/" className="lien text-sm">
            ← Tous les projets
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{projet.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-sourdine">
            <span className={`pastille ${couleurStatut(projet.status)}`}>{STATUTS_PROJET[projet.status]}</span>
            {projet.client_name && <span>{projet.client_name}</span>}
            <span>· {projet.aspect_ratio}</span>
            <span>· modifié le {dateCourte(projet.updated_at)}</span>
          </p>
        </div>
        <Link href={`/projets/${id}/plans`} className="bouton">
          Plans et vidéos ({plans.length}) →
        </Link>
      </div>

      {message && <p className="message-ok">{MESSAGES[message]}</p>}
      {sp.erreur && <p className="message-erreur">L'enregistrement a échoué. Réessayez dans un instant.</p>}

      {/* Avancement en 4 étapes */}
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: 1, titre: "Scénario", fait: scenarioValide },
          { n: 2, titre: "Plans", fait: plans.length > 0 && plans.every((p) => p.image_path) },
          { n: 3, titre: "Vidéos validées", fait: plans.length > 0 && valides.length === plans.length },
          { n: 4, titre: "Montage et export", fait: projet.status === "livre" },
        ].map((e) => (
          <li
            key={e.n}
            className={`rounded-xl border px-4 py-3 text-sm ${
              e.fait ? "border-succes/40 bg-succes-doux text-succes" : "border-ligne bg-surface text-sourdine"
            }`}
          >
            <span className="font-bold">{e.fait ? "✓" : `${e.n}.`}</span> {e.titre}
          </li>
        ))}
      </ol>

      {/* Montage : les plans validés, dans l'ordre du scénario */}
      <section className="carte flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Montage</h2>
          <span className="text-sm text-sourdine">
            {valides.length} plan{valides.length > 1 ? "s" : ""} validé{valides.length > 1 ? "s" : ""} sur {plans.length} ·
            durée {dureeLisible(dureeMontage)}
          </span>
        </div>
        {valides.length === 0 ? (
          <p className="text-sm text-sourdine">
            Les vidéos que vous validez dans « Plans et vidéos » arrivent ici automatiquement, dans l'ordre du scénario. La
            durée finale n'est pas limitée : elle dépend du nombre de plans.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {valides.map((p) => {
              const video = p.takes.find((t) => t.id === p.validated_take_id)?.video_path;
              const url = video ? liens.get(video) : undefined;
              return (
                <Link key={p.id} href={`/projets/${id}/plans#plan-${p.id}`} className="w-48 shrink-0">
                  {url ? (
                    <video src={url} muted playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-black object-cover" />
                  ) : (
                    <div className="aspect-video rounded-lg bg-surface-2" />
                  )}
                  <p className="mt-1 text-xs text-sourdine">
                    Plan {plans.indexOf(p) + 1} · {Number(p.duration_s || 5)} s
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Tous les plans */}
      <section className="carte flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Plans</h2>
          <Link href={`/projets/${id}/plans`} className="lien ml-auto text-sm">
            Gérer les plans →
          </Link>
        </div>
        {plans.length === 0 ? (
          <p className="text-sm text-sourdine">
            Aucun plan. Ajoutez-les un par un, ou toutes les photos et le script d'un coup, dans « Plans et vidéos ».
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {plans.map((p, i) => {
              const photo = p.image_path ? liens.get(p.image_path) : undefined;
              return (
                <li key={p.id}>
                  <Link href={`/projets/${id}/plans#plan-${p.id}`} className="block">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt="" className="aspect-video w-full rounded-lg object-cover" />
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-ligne text-xs text-sourdine">
                        Photo manquante
                      </div>
                    )}
                    <p className="mt-1 flex items-center justify-between gap-1 text-xs">
                      <span className="font-semibold">Plan {i + 1}</span>
                      <span className={`pastille ${couleurStatut(p.status)}`}>{STATUTS_PLAN[p.status]}</span>
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form action={enregistrerProjet.bind(null, id)} className="carte grid gap-4 sm:grid-cols-2">
          <h2 className="text-lg font-bold sm:col-span-2">Informations et scénario</h2>
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
            <label htmlFor="scenario_text" className="etiquette">
              Scénario {scenarioValide && <span className="pastille ml-2 bg-succes-doux text-succes">Validé</span>}
            </label>
            <p className="mb-2 text-sm text-sourdine">
              Séparez les scènes par une ligne « Scène 1 », « Scène 2 »… Vous pourrez ensuite créer tous les plans d'un coup.
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
            <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
          </div>
        </form>

        <div className="flex flex-col gap-6">
          <section className="carte flex flex-col gap-3">
            <h2 className="font-bold">Validation du scénario</h2>
            {scenarioValide ? (
              <>
                <p className="text-sm text-sourdine">Validé le {dateCourte(projet.scenario_validated_at)}.</p>
                <form action={validerScenario.bind(null, id, false)}>
                  <BoutonEnvoi className="bouton-discret w-full" enCours="…">
                    Rouvrir le scénario
                  </BoutonEnvoi>
                </form>
              </>
            ) : (
              <>
                <p className="text-sm text-sourdine">Enregistrez d'abord vos changements, puis validez.</p>
                <form action={validerScenario.bind(null, id, true)}>
                  <BoutonEnvoi className="bouton w-full" enCours="Validation…">
                    ✓ Valider le scénario
                  </BoutonEnvoi>
                </form>
              </>
            )}
          </section>

          <section className="carte">
            <h2 className="font-bold">Historique du scénario</h2>
            {versions && versions.length > 0 ? (
              <ul className="mt-3 flex flex-col divide-y divide-ligne">
                {(versions as Version[]).map((v) => (
                  <li key={v.id} className="flex flex-col gap-1 py-2 text-sm">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sourdine">
                        {new Date(v.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <form action={restaurerScenario.bind(null, id, v.id)}>
                        <BoutonEnvoi className="lien" enCours="…">
                          Restaurer
                        </BoutonEnvoi>
                      </form>
                    </span>
                    <span className="truncate">{v.data.scenario_text?.slice(0, 80) || "(vide)"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-sourdine">Chaque enregistrement du scénario garde une copie ici.</p>
            )}
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
    </div>
  );
}
