import { redirect } from "next/navigation";
import { requireProfile, type Profile } from "@/lib/session";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { changerAcces, changerRole, fixerBudget, inviterMembre } from "./actions";

const ERREURS: Record<string, string> = {
  "email-vide": "Saisissez l'adresse e-mail de la personne à inviter.",
  invitation: "L'invitation n'a pas pu être envoyée.",
  "soi-meme": "Vous ne pouvez pas changer votre propre accès ni votre propre rôle.",
  budget: "Saisissez un montant en dollars, par exemple 25.",
};

const ACTIONS: Record<string, string> = {
  creation: "a créé le projet",
  corbeille: "a mis à la corbeille un projet",
  invitation: "a invité",
  desactivation: "a désactivé un compte",
  reactivation: "a réactivé un compte",
  budget: "a fixé le budget du mois",
  role: "a changé le rôle d'un membre",
  restauration: "a restauré un projet",
  ajout: "a ajouté un plan",
  import: "a importé des plans",
  generation: "a lancé une génération",
  validation: "a validé une vidéo",
  "validation-scenario": "a validé un scénario",
};

export default async function Equipe({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; detail?: string; invite?: string; budget?: string }>;
}) {
  const { erreur, detail, invite, budget } = await searchParams;
  const { supabase, profile } = await requireProfile();
  if (profile.role !== "responsable") redirect("/");

  const now = new Date();
  const mois = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: membres }, { data: budgetMois }, { data: depense }, { data: journal }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, role, active").order("created_at"),
    supabase.from("monthly_budgets").select("limit_usd").eq("month", mois).maybeSingle(),
    supabase.rpc("month_spend_usd"),
    supabase
      .from("activity_log")
      .select("id, action, details, created_at, actor_id")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const noms = new Map((membres ?? []).map((m) => [m.id, m.display_name]));
  const limite = budgetMois ? Number(budgetMois.limit_usd) : null;
  const depenseMois = Number(depense ?? 0);
  const part = limite ? Math.min(100, Math.round((depenseMois / limite) * 100)) : 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">Équipe et budget</h1>

      {invite && <p className="message-ok">Invitation envoyée à {invite}.</p>}
      {budget && <p className="message-ok">Budget du mois enregistré.</p>}
      {erreur && ERREURS[erreur] && (
        <p className="message-erreur">
          {ERREURS[erreur]} {detail}
        </p>
      )}

      <section className="carte flex flex-col gap-4">
        <h2 className="text-lg font-bold">Budget GPU du mois</h2>
        <div>
          <div className="flex justify-between text-sm">
            <span>
              Dépensé : <b>{depenseMois.toFixed(2)} $</b>
            </span>
            <span className="text-sourdine">{limite === null ? "Aucune limite fixée" : `Limite : ${limite.toFixed(2)} $`}</span>
          </div>
          {limite !== null && (
            <div className="mt-2 h-2 rounded-full bg-fond">
              <div
                className={`h-2 rounded-full ${part >= 80 ? "bg-alerte" : "bg-accent"}`}
                style={{ width: `${part}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-sm text-sourdine">
            Quand la limite est atteinte, plus aucune vidéo ne peut être générée ce mois-ci, jusqu'à ce que vous l'augmentiez.
          </p>
        </div>
        <form action={fixerBudget} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="limit_usd" className="etiquette">
              Limite du mois ($)
            </label>
            <input
              id="limit_usd"
              name="limit_usd"
              inputMode="decimal"
              defaultValue={limite ?? 25}
              className="champ w-32"
            />
          </div>
          <BoutonEnvoi enCours="Enregistrement…">Enregistrer la limite</BoutonEnvoi>
        </form>
      </section>

      <section className="carte flex flex-col gap-4">
        <h2 className="text-lg font-bold">Membres</h2>
        <ul className="divide-y divide-ligne">
          {((membres ?? []) as Profile[]).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="font-semibold">{m.display_name}</span>
              <span className="text-sm text-sourdine">{m.role === "responsable" ? "Responsable" : "Membre"}</span>
              {!m.active && <span className="rounded bg-fond px-2 py-0.5 text-xs font-semibold">Désactivé</span>}
              {m.id !== profile.id && (
                <div className="ml-auto flex items-center gap-2">
                  <form action={changerRole.bind(null, m.id, m.role === "responsable" ? "membre" : "responsable")}>
                    <BoutonEnvoi className="bouton-discret px-3 py-1 text-sm" enCours="…">
                      {m.role === "responsable" ? "Passer membre" : "Passer responsable"}
                    </BoutonEnvoi>
                  </form>
                  <form action={changerAcces.bind(null, m.id, !m.active)}>
                    <BoutonEnvoi className={m.active ? "bouton-danger" : "bouton-discret px-3 py-1 text-sm"} enCours="…">
                      {m.active ? "Désactiver" : "Réactiver"}
                    </BoutonEnvoi>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
        <form action={inviterMembre} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="display_name" className="etiquette">
              Prénom
            </label>
            <input id="display_name" name="display_name" className="champ" />
          </div>
          <div>
            <label htmlFor="email" className="etiquette">
              E-mail
            </label>
            <input id="email" name="email" type="email" required className="champ" />
          </div>
          <BoutonEnvoi enCours="Envoi…">Inviter</BoutonEnvoi>
        </form>
      </section>

      <section className="carte">
        <h2 className="text-lg font-bold">Activité récente</h2>
        {journal && journal.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {journal.map((j) => (
              <li key={j.id}>
                <span className="text-sourdine">
                  {new Date(j.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                </span>{" "}
                <b>{noms.get(j.actor_id ?? "") ?? "Quelqu'un"}</b> {ACTIONS[j.action] ?? j.action}
                {j.details?.title ? ` « ${j.details.title} »` : ""}
                {j.details?.email ? ` ${j.details.email}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sourdine">Rien pour l'instant.</p>
        )}
      </section>
    </div>
  );
}
