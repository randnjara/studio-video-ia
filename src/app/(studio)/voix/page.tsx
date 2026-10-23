import { requireProfile } from "@/lib/session";
import { CHAMPS_VOIX, type Voix } from "@/lib/voix";
import { AjoutModele } from "./ajout-modele";
import { AjoutPersonne } from "./ajout-personne";
import { Catalogue } from "./catalogue";

// Les voix de l'équipe : celles fournies par défaut, et celles qu'on ajoute au fur et à mesure
export default async function PageVoix() {
  const { supabase, profile } = await requireProfile();
  const { data, error } = await supabase.from("voix").select(CHAMPS_VOIX).order("par_defaut", { ascending: false }).order("nom");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🎙 Voix</h1>
        <p className="text-sm text-sourdine">
          Toutes les voix utilisables dans le studio voix des projets (onglet « Studio voix » d&apos;un projet). Les voix marquées
          « effet » sont une voix de base passée dans la table de mixage. Les voix marquées ⚠ ne doivent pas servir à un usage
          commercial.
        </p>
      </div>

      {error ? (
        <p className="message-erreur">
          La base n&apos;est pas encore prête pour les voix : appliquez la migration <code>0014_voix.sql</code> dans Supabase (SQL
          Editor).
        </p>
      ) : (
        <>
          <Catalogue voix={(data ?? []) as Voix[]} moi={profile.id} responsable={profile.role === "responsable"} />
          <AjoutPersonne />
          <AjoutModele />
        </>
      )}
    </div>
  );
}
