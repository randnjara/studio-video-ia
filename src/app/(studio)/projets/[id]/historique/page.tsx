import { ListeHistorique } from "../../../historique/liste";

// Historique des travaux serveur du projet (et la vie des serveurs pendant ce temps)
export default async function PageHistoriqueProjet({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <ListeHistorique filtres={sp} base={`/projets/${id}/historique`} projetFixe={id} />;
}
