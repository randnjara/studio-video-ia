"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type Etape = {
  href: string;
  titre: string;
  detail: string;
  etat: "fait" | "actuelle" | "a_venir";
};

// Les 5 étapes du projet, en onglets. L'étape où en est le projet est en couleur,
// les étapes finies en vert, et l'onglet ouvert est souligné.
export function EtapesProjet({ etapes }: { etapes: Etape[] }) {
  const chemin = usePathname();
  return (
    <nav aria-label="Étapes du projet" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {etapes.map((e, i) => {
        const ouvert = chemin === e.href;
        const couleur =
          e.etat === "actuelle"
            ? "border-accent bg-accent-doux text-accent"
            : e.etat === "fait"
              ? "border-succes/40 bg-succes-doux text-succes"
              : "border-ligne bg-surface text-sourdine hover:text-encre";
        return (
          <Link
            key={e.href}
            href={e.href}
            aria-current={ouvert ? "page" : undefined}
            className={`relative flex flex-col rounded-xl border px-4 py-3 text-sm transition ${couleur} ${
              ouvert ? "ring-2 ring-current ring-offset-2 ring-offset-fond" : ""
            }`}
          >
            <span className="flex items-center gap-2 font-bold">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  e.etat === "actuelle"
                    ? "bg-accent text-accent-texte"
                    : e.etat === "fait"
                      ? "bg-succes text-surface"
                      : "bg-surface-2 text-sourdine"
                }`}
              >
                {e.etat === "fait" ? "✓" : i + 1}
              </span>
              {e.titre}
            </span>
            <span className="mt-1 truncate text-xs opacity-80">
              {e.etat === "actuelle" ? `Étape actuelle · ${e.detail}` : e.detail}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
