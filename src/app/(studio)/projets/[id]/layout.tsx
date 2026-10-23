import Link from "next/link";
import { notFound } from "next/navigation";
import { EtapesProjet, type Etape } from "@/components/etapes-projet";
import { STATUTS_PROJET, couleurStatut } from "@/lib/libelles";
import { getClient, requireProfile } from "@/lib/session";

// Cadre commun aux pages d'un projet : titre et les 5 étapes Infos → ChatGPT → Plans → Clips → Montage
export default async function CadreProjet({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getClient();

  // La vérification du profil et les requêtes du projet partent en même temps
  const [, { data: projet }, { data: scenes }, { data: montages }, { count: personnages }] = await Promise.all([
    requireProfile(),
    supabase
      .from("projects")
      .select("id, title, client_name, aspect_ratio, status")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("scenes").select("status, image_path").eq("project_id", id),
    supabase.from("montages").select("status").eq("project_id", id),
    supabase.from("film_refs").select("id", { count: "exact", head: true }).eq("project_id", id).eq("genre", "personnage"),
  ]);
  if (!projet) notFound();

  const plans = scenes ?? [];
  const avecPhoto = plans.filter((p) => p.image_path).length;
  const valides = plans.filter((p) => p.status === "validee").length;
  const aValider = plans.filter((p) => p.status === "a_valider").length;
  const enGeneration = plans.filter((p) => p.status === "en_generation").length;
  const liste = montages ?? [];
  const montageValide = liste.some((m) => m.status === "valide");

  const fait = [
    (personnages ?? 0) > 0 || plans.length > 0,
    plans.length > 0,
    plans.length > 0 && avecPhoto === plans.length,
    plans.length > 0 && valides === plans.length,
    montageValide,
  ];
  const actuelle = fait.findIndex((f) => !f);
  const etat = (i: number): Etape["etat"] => (i === actuelle ? "actuelle" : fait[i] ? "fait" : "a_venir");
  const base = `/projets/${id}`;

  const etapes: Etape[] = [
    { href: base, titre: "Infos", detail: personnages ? "Voix off, personnages" : "Photo du personnage à ajouter", etat: etat(0) },
    { href: `${base}/chatgpt`, titre: "ChatGPT / Claude", detail: plans.length ? "Tableau importé" : "Tableau des plans", etat: etat(1) },
    {
      href: `${base}/plans`,
      titre: "Plans",
      detail: plans.length ? `${plans.length} plan${plans.length > 1 ? "s" : ""}, ${avecPhoto} avec photo` : "À créer",
      etat: etat(2),
    },
    {
      href: `${base}/clips`,
      titre: "Clips",
      detail: enGeneration
        ? `${enGeneration} en génération`
        : aValider
          ? `${aValider} à valider`
          : `${valides} validé${valides > 1 ? "s" : ""}`,
      etat: etat(3),
    },
    {
      href: `${base}/montage`,
      titre: "Montage",
      detail: liste.length ? `${liste.length} montage${liste.length > 1 ? "s" : ""}` : "À assembler",
      etat: actuelle === -1 ? "fait" : etat(4),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/" className="lien text-sm">
          ← Tous les projets
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{projet.title}</h1>
          <span className={`pastille ${couleurStatut(projet.status)}`}>{STATUTS_PROJET[projet.status]}</span>
          <span className="text-sm text-sourdine">Format {projet.aspect_ratio}</span>
        </div>
      </div>
      <EtapesProjet etapes={etapes} />
      {children}
    </div>
  );
}
