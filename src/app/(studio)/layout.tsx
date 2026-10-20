import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { Navigation, type Entree } from "@/components/navigation";
import { ChoixTheme } from "@/components/theme";
import { requireProfile } from "@/lib/session";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();

  const entrees: Entree[] = [
    { href: "/", libelle: "Projets", icone: "🎬" },
    ...(profile.role === "responsable" ? [{ href: "/equipe", libelle: "Équipe et budget", icone: "👥" }] : []),
  ];

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 z-10 flex flex-col gap-3 border-b border-ligne bg-surface px-4 py-3 md:h-screen md:w-60 md:shrink-0 md:gap-6 md:border-r md:border-b-0 md:py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-texte">▶</span>
            Studio Vidéo IA
          </Link>
        </div>
        <Navigation entrees={entrees} />
        <div className="hidden flex-col gap-1 md:mt-auto md:flex">
          <ChoixTheme />
          <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2">
            <p className="truncate text-sm font-semibold">{profile.display_name}</p>
            <p className="text-xs text-sourdine">{profile.role === "responsable" ? "Responsable" : "Membre"}</p>
          </div>
          <form action="/auth/deconnexion" method="post">
            <BoutonEnvoi className="bouton-danger w-full justify-start" enCours="Déconnexion…">
              Se déconnecter
            </BoutonEnvoi>
          </form>
        </div>
        <div className="flex items-center gap-2 md:hidden">
          <div className="flex-1">
            <ChoixTheme />
          </div>
          <form action="/auth/deconnexion" method="post">
            <BoutonEnvoi className="bouton-danger" enCours="…">
              Se déconnecter
            </BoutonEnvoi>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl min-w-0 px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
