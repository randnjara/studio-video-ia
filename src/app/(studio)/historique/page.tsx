import { ListeHistorique } from "./liste";

// 🧾 Historique : tous les travaux serveur de l'équipe (ceux des projets que l'on voit) et la vie des serveurs
export default async function PageHistorique({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">🧾 Historique</h1>
        <p className="text-sm text-sourdine">
          Tout ce qui passe par un serveur : voix, découpe, Whisper, photos, vidéos, lip-sync, avec chaque étape, sa durée, le
          coût, qui l&apos;a lancé et l&apos;erreur éventuelle. Les arrêts, redémarrages et nouvelles images des serveurs y sont aussi.
        </p>
      </div>
      <ListeHistorique filtres={sp} base="/historique" />
    </div>
  );
}
