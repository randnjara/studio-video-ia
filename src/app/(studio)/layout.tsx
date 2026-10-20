import Link from "next/link";
import { requireProfile } from "@/lib/session";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireProfile();

  return (
    <div className="min-h-screen">
      <header className="border-b border-ligne bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-bold">
            Studio Vidéo IA
          </Link>
          <nav className="flex gap-4 text-sm font-semibold text-sourdine">
            <Link href="/" className="hover:text-encre">
              Projets
            </Link>
            {profile.role === "responsable" && (
              <Link href="/equipe" className="hover:text-encre">
                Équipe et budget
              </Link>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-sourdine">
              {profile.display_name} · {profile.role === "responsable" ? "Responsable" : "Membre"}
            </span>
            <form action="/auth/deconnexion" method="post">
              <button type="submit" className="font-semibold text-accent hover:underline">
                Se déconnecter
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
