import { BoutonEnvoi } from "@/components/bouton-envoi";
import { confirmerLien } from "./actions";

// Page ouverte par le lien de connexion : la connexion ne se fait qu'au clic (voir /auth/confirm)
export default async function LienConnexion({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash, type } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">Studio Vidéo IA</p>
        <h1 className="mt-1 text-3xl font-bold">Bienvenue</h1>
        <p className="mt-2 text-sourdine">Cliquez sur le bouton pour entrer dans le studio.</p>
      </div>
      <form action={confirmerLien} className="carte flex flex-col gap-4">
        <input type="hidden" name="token_hash" value={token_hash ?? ""} />
        <input type="hidden" name="type" value={type ?? ""} />
        <BoutonEnvoi enCours="Connexion…">Me connecter</BoutonEnvoi>
      </form>
    </main>
  );
}
