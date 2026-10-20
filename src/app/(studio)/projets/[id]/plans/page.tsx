import Link from "next/link";
import { notFound } from "next/navigation";
import { PRIX_ESTIME_5S_USD } from "@/lib/runpod";
import { requireProfile } from "@/lib/session";
import {
  actualiserEssais,
  ajouterPlan,
  annulerValidation,
  deplacerPlan,
  genererEssai,
  modifierPlan,
  supprimerPlan,
  validerEssai,
} from "./actions";
import { SuiviEssais } from "./suivi-essais";

type Essai = {
  id: string;
  status: "en_attente" | "en_cours" | "terminee" | "echouee" | "annulee";
  video_path: string | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
};

type Plan = {
  id: string;
  position: number;
  motion_prompt: string;
  voiceover_text: string;
  image_path: string | null;
  consent_confirmed: boolean;
  status: string;
  validated_take_id: string | null;
  takes: Essai[];
};

const STATUTS_PLAN: Record<string, string> = {
  brouillon: "Brouillon",
  en_generation: "En génération",
  a_valider: "À valider",
  validee: "Validé",
  refusee: "Refusé",
};

const ERREURS: Record<string, string> = {
  plan: "Le plan n'a pas pu être enregistré. Réessayez.",
  "photo-format": "La photo doit être au format JPG, PNG ou WebP.",
  "photo-taille": "La photo est trop lourde (10 Mo maximum).",
  "photo-envoi": "La photo n'a pas pu être envoyée. Réessayez.",
  "sans-photo": "Ajoutez une photo au plan avant de générer.",
  "sans-prompt": "Décrivez le mouvement voulu avant de générer.",
  "sans-accord": "Cochez la case d'accord des personnes photographiées avant de générer.",
  budget: "Le plafond GPU du mois est atteint. Le responsable peut l'augmenter dans « Équipe et budget ».",
  essai: "La génération n'a pas pu démarrer. Réessayez.",
};

export default async function PagePlans({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erreur?: string; enregistre?: string }>;
}) {
  const { id } = await params;
  const { erreur, enregistre } = await searchParams;
  const { supabase } = await requireProfile();

  const { data: projet } = await supabase
    .from("projects")
    .select("id, title, aspect_ratio")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!projet) notFound();

  // Range d'abord les vidéos qui ont fini pendant que la page était fermée
  await actualiserEssais(id);

  const { data } = await supabase
    .from("scenes")
    .select(
      "id, position, motion_prompt, voiceover_text, image_path, consent_confirmed, status, validated_take_id, takes(id, status, video_path, cost_usd, error, created_at)",
    )
    .eq("project_id", id)
    .order("position")
    .order("created_at", { referencedTable: "takes", ascending: false });
  const plans = (data ?? []) as Plan[];

  // Liens temporaires (1 h) pour afficher les photos et les vidéos privées
  const chemins = plans.flatMap((p) => [
    ...(p.image_path ? [p.image_path] : []),
    ...p.takes.flatMap((t) => (t.video_path ? [t.video_path] : [])),
  ]);
  const liens = new Map<string, string>();
  if (chemins.length > 0) {
    const { data: signes } = await supabase.storage.from("medias").createSignedUrls(chemins, 60 * 60);
    for (const s of signes ?? []) if (s.path && s.signedUrl) liens.set(s.path, s.signedUrl);
  }

  const enCours = plans.reduce((n, p) => n + p.takes.filter((t) => t.status === "en_cours").length, 0);
  const valides = plans.filter((p) => p.status === "validee").length;
  const cout = plans.reduce((n, p) => n + p.takes.reduce((m, t) => m + Number(t.cost_usd ?? 0), 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projets/${id}`} className="text-sm font-semibold text-accent hover:underline">
          ← Fiche du projet
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Plans de « {projet.title} »</h1>
        <p className="text-sourdine">
          Format {projet.aspect_ratio} · {plans.length} plan{plans.length > 1 ? "s" : ""} · {valides} validé
          {valides > 1 ? "s" : ""} · dépensé {cout.toFixed(2)} $
        </p>
      </div>

      {erreur && ERREURS[erreur] && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-alerte">{ERREURS[erreur]}</p>}
      {enregistre && <p className="rounded-md bg-accent-doux px-4 py-2 text-sm">Plan enregistré.</p>}
      <SuiviEssais projectId={id} enCours={enCours} />

      {plans.map((plan, i) => {
        const photo = plan.image_path ? liens.get(plan.image_path) : undefined;
        const enGeneration = plan.takes.some((t) => t.status === "en_cours");
        return (
          <section key={plan.id} id={`plan-${plan.id}`} className="carte flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">Plan {i + 1}</h2>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  plan.status === "validee" ? "bg-accent text-white" : "bg-fond text-sourdine"
                }`}
              >
                {STATUTS_PLAN[plan.status] ?? plan.status}
              </span>
              <div className="ml-auto flex gap-3 text-sm font-semibold">
                {i > 0 && (
                  <form action={deplacerPlan.bind(null, id, plan.id, -1)}>
                    <button type="submit" className="text-accent hover:underline">
                      ↑ Monter
                    </button>
                  </form>
                )}
                {i < plans.length - 1 && (
                  <form action={deplacerPlan.bind(null, id, plan.id, 1)}>
                    <button type="submit" className="text-accent hover:underline">
                      ↓ Descendre
                    </button>
                  </form>
                )}
              </div>
            </div>

            <form action={modifierPlan.bind(null, id, plan.id)} className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={`Photo du plan ${i + 1}`} className="w-full rounded-md border border-ligne" />
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-md border border-dashed border-ligne text-sm text-sourdine">
                    Pas de photo
                  </div>
                )}
                <label className="etiquette mt-2" htmlFor={`photo-${plan.id}`}>
                  {photo ? "Changer la photo" : "Ajouter une photo"}
                </label>
                <input id={`photo-${plan.id}`} name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
              </div>
              <ChampsPlan plan={plan} />
              <div className="sm:col-span-2">
                <button type="submit" className="bouton-discret">
                  Enregistrer le plan
                </button>
              </div>
            </form>

            <div className="flex flex-wrap items-center gap-3 border-t border-ligne pt-4">
              <form action={genererEssai.bind(null, id, plan.id)}>
                <button type="submit" className="bouton" disabled={enGeneration}>
                  {enGeneration ? "Génération en cours…" : plan.takes.length > 0 ? "Générer un autre essai" : "Générer la vidéo"}
                </button>
              </form>
              <span className="text-sm text-sourdine">environ {PRIX_ESTIME_5S_USD.toFixed(2)} $ par essai de 5 s</span>
              <form action={supprimerPlan.bind(null, id, plan.id)} className="ml-auto">
                <button type="submit" className="text-sm font-semibold text-alerte hover:underline">
                  Supprimer le plan
                </button>
              </form>
            </div>

            {plan.takes.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {plan.takes.map((t, n) => {
                  const video = t.video_path ? liens.get(t.video_path) : undefined;
                  const choisi = plan.validated_take_id === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`rounded-md border p-3 ${choisi ? "border-accent ring-2 ring-accent/30" : "border-ligne"}`}
                    >
                      <p className="mb-2 text-sm font-semibold">
                        Essai {plan.takes.length - n}
                        {choisi && <span className="ml-2 text-accent">✓ choisi pour le montage</span>}
                      </p>
                      {t.status === "en_cours" && <p className="text-sm text-sourdine">Génération en cours…</p>}
                      {t.status === "echouee" && (
                        <p className="text-sm text-alerte">Échec (non facturé) : {t.error ?? "erreur inconnue"}</p>
                      )}
                      {video && (
                        <>
                          <video src={video} controls loop playsInline className="w-full rounded-md bg-black" />
                          <div className="mt-2 flex flex-wrap gap-3 text-sm font-semibold">
                            {choisi ? (
                              <form action={annulerValidation.bind(null, id, plan.id)}>
                                <button type="submit" className="text-sourdine hover:underline">
                                  Annuler le choix
                                </button>
                              </form>
                            ) : (
                              <form action={validerEssai.bind(null, id, plan.id, t.id)}>
                                <button type="submit" className="text-accent hover:underline">
                                  ✓ Valider cet essai
                                </button>
                              </form>
                            )}
                            <a href={video} download className="text-accent hover:underline">
                              Télécharger
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <section className="carte">
        <h2 className="text-lg font-bold">Ajouter un plan</h2>
        <p className="mt-1 text-sm text-sourdine">
          Un plan = une photo + le mouvement voulu. Il donnera un clip de 5 secondes. Comptez environ 20 plans pour 1 min 40.
        </p>
        <form action={ajouterPlan.bind(null, id)} className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
          <div>
            <label className="etiquette" htmlFor="photo-nouveau">
              Photo
            </label>
            <input id="photo-nouveau" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" />
          </div>
          <ChampsPlan />
          <div className="sm:col-span-2">
            <button type="submit" className="bouton">
              Ajouter le plan
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ChampsPlan({ plan }: { plan?: Plan }) {
  const suffixe = plan?.id ?? "nouveau";
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="etiquette" htmlFor={`motion-${suffixe}`}>
          Mouvement voulu (en anglais de préférence)
        </label>
        <textarea
          id={`motion-${suffixe}`}
          name="motion_prompt"
          rows={3}
          defaultValue={plan?.motion_prompt}
          placeholder="Ex. : slow zoom in, the woman smiles and turns her head toward the camera, soft morning light"
          className="champ text-sm"
        />
      </div>
      <div>
        <label className="etiquette" htmlFor={`voix-${suffixe}`}>
          Texte de la voix off sur ce plan
        </label>
        <textarea
          id={`voix-${suffixe}`}
          name="voiceover_text"
          rows={2}
          defaultValue={plan?.voiceover_text}
          className="champ text-sm"
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent_confirmed" defaultChecked={plan?.consent_confirmed} className="mt-1" />
        Les personnes visibles sur la photo sont d'accord pour être animées en vidéo.
      </label>
    </div>
  );
}
