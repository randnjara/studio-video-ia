import { signerLiens } from "@/lib/production";
import { getClient } from "@/lib/session";
import { CHAMPS_VOIX, type Voix } from "@/lib/voix";
import { CHAMPS_CREATION, type Creation, lireServeurVoix } from "@/lib/voix-serveur";
import { Studio } from "./studio";

// Studio voix du projet : texte → voix, enregistrements transformés, table de mixage, puis envoi au montage
export default async function PageVoix({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getClient();
  const [{ data: voix, error }, { data: creations }, { data: scenes }, { serveur }] = await Promise.all([
    supabase.from("voix").select(CHAMPS_VOIX).order("par_defaut", { ascending: false }).order("nom"),
    supabase.from("voix_creations").select(CHAMPS_CREATION).eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("scenes").select("voiceover_text").eq("project_id", id).order("position"),
    lireServeurVoix(supabase),
  ]);

  if (error)
    return (
      <section className="carte">
        <h2 className="text-lg font-bold">Studio voix</h2>
        <p className="message-erreur mt-2">
          La base n&apos;est pas encore prête pour le studio voix : appliquez la migration <code>0014_voix.sql</code> dans
          Supabase (SQL Editor).
        </p>
      </section>
    );

  const liste = (creations ?? []) as Creation[];
  const liens = await signerLiens(
    supabase,
    liste.flatMap((c) => [c.audio_path, c.mixage_path]),
  );

  return (
    <Studio
      projectId={id}
      voix={(voix ?? []) as Voix[]}
      serveurPret={Boolean(serveur)}
      plans={(scenes ?? []).map((s, i) => ({ numero: i + 1, texte: String(s.voiceover_text ?? "").trim() }))}
      creations={liste.map((c) => ({
        id: c.id,
        voixId: c.voix_id,
        nom: c.nom,
        texte: c.texte,
        transformee: Boolean(c.source_path),
        status: c.status,
        emotion: Number(c.emotion) || 0.5,
        reglages: c.reglages ?? {},
        urlAudio: c.audio_path ? (liens.get(c.audio_path) ?? null) : null,
        urlMixage: c.mixage_path ? (liens.get(c.mixage_path) ?? null) : null,
        duree: c.duree_s !== null ? Number(c.duree_s) : null,
        cout: c.cost_usd !== null ? Number(c.cost_usd) : null,
        erreur: c.status === "echouee" ? c.error : null,
      }))}
    />
  );
}
