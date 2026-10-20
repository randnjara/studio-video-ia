"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Entree = { href: string; libelle: string; icone: string };

// Menu principal : met en avant la page ouverte.
export function Navigation({ entrees }: { entrees: Entree[] }) {
  const chemin = usePathname();
  return (
    <nav className="flex gap-1 md:flex-col">
      {entrees.map((e) => {
        const actif = e.href === "/" ? chemin === "/" || chemin.startsWith("/projets") : chemin.startsWith(e.href);
        return (
          <Link
            key={e.href}
            href={e.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              actif ? "bg-accent-doux text-accent" : "text-sourdine hover:bg-surface-2 hover:text-encre"
            }`}
          >
            <span aria-hidden className="text-base">
              {e.icone}
            </span>
            {e.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
