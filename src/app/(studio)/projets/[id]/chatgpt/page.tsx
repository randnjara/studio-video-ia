import Link from "next/link";
import { getClient } from "@/lib/session";
import { ImportTableau } from "../plans/import-tableau";
import { PreparationTableau } from "../plans/preparation";

// Étape 2 : ChatGPT prépare le tableau des plans à partir des informations de l'étape 1, puis on importe le fichier rempli
export default async function PageChatGPT({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await getClient();
  const [{ data: projet }, { data: refsLues }, { count: plans }] = await Promise.all([
    supabase.from("projects").select("title, aspect_ratio, scenario_text, style_text, resume").eq("id", id).maybeSingle(),
    supabase.from("film_refs").select("nom, genre, description").eq("project_id", id).order("created_at"),
    supabase.from("scenes").select("id", { count: "exact", head: true }).eq("project_id", id),
  ]);
  if (!projet) return null;
  const refs = refsLues ?? [];
  const personnages = refs.filter((r) => r.genre === "personnage").map((r) => r.nom);
  const lieux = refs.filter((r) => r.genre === "lieu").map((r) => r.nom);
  const produits = [...new Set(refs.filter((r) => r.genre === "produit").map((r) => r.nom))];
  const mots = projet.scenario_text.trim().split(/\s+/).filter(Boolean).length;

  // Rappel de l'étape 1 : ce que ChatGPT recevra
  const rappel = [
    { ok: personnages.length > 0, texte: personnages.length ? `Personnage : ${personnages.join(", ")}` : "Photo du personnage principal manquante", requis: true },
    { ok: mots > 0, texte: mots ? `Voix off : ${mots} mots` : "Voix off pas encore collée (vous pourrez la joindre dans l'assistant)" },
    { ok: Boolean(projet.resume.trim()), texte: projet.resume.trim() ? "Résumé donné" : "Pas de résumé (l'assistant le déduira de la voix off)" },
    { ok: lieux.length > 0, texte: lieux.length ? `Lieux : ${lieux.join(", ")}` : "Pas de lieu (l'assistant en choisira le moins possible)" },
    ...(produits.length ? [{ ok: true, texte: `Produit à promouvoir : ${produits.join(", ")}` }] : []),
    { ok: Boolean(projet.style_text.trim()), texte: projet.style_text.trim() ? "Style donné" : "Pas de style (l'assistant en proposera un)" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {sp.infos && <p className="message-ok">Informations enregistrées. Étape 2 : préparez le tableau des plans avec ChatGPT ou Claude.</p>}

      <section className="carte flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">Ce que l'assistant recevra</h2>
          <Link href={`/projets/${id}`} className="lien text-sm">
            Modifier à l'étape 1
          </Link>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {rappel.map((r) => (
            <li key={r.texte} className={r.ok ? "" : r.requis ? "text-alerte" : "text-sourdine"}>
              {r.ok ? "✓" : r.requis ? "⚠" : "○"} {r.texte}
            </li>
          ))}
        </ul>
      </section>

      <section className="carte flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">1. Préparer le tableau dans ChatGPT ou Claude</h2>
          <p className="text-sm text-sourdine">
            L'assistant découpe la voix off en plans et remplit le fichier : texte de chaque plan, durée, cadrage, lieu, poses, prompt
            de la photo et prompt de la vidéo. Tout ce dont le studio a besoin, en une seule fois.
          </p>
        </div>
        <PreparationTableau
          titre={projet.title}
          format={projet.aspect_ratio}
          style={projet.style_text}
          script={projet.scenario_text}
          resume={projet.resume}
          refs={refs}
        />
      </section>

      <section className="carte flex flex-col gap-4" id="import">
        <div>
          <h2 className="text-lg font-bold">2. Importer le fichier rempli</h2>
          <p className="text-sm text-sourdine">
            Téléchargez le fichier rempli par l'assistant et choisissez-le ici, sans le modifier. Les plans sont créés et vous passez à
            l'étape 3.
            {plans ? ` Ce projet a déjà ${plans} plan${plans > 1 ? "s" : ""} : les nouveaux s'ajoutent à la suite.` : ""}
          </p>
        </div>
        <ImportTableau projectId={id} personnageParDefaut={personnages[0] ?? ""} />
      </section>
    </div>
  );
}
