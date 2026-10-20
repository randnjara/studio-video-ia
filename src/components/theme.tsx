"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// Bascule entre thème clair et sombre ; le choix est retenu sur cet appareil.
export function ChoixTheme() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function changer() {
    const suivant: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = suivant;
    try {
      localStorage.setItem("theme", suivant);
    } catch {}
    setTheme(suivant);
  }

  return (
    <button
      type="button"
      onClick={changer}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sourdine transition hover:bg-surface-2 hover:text-encre"
    >
      <span aria-hidden className="text-base">
        {theme === "dark" ? "☀️" : "🌙"}
      </span>
      {theme === "dark" ? "Thème clair" : "Thème sombre"}
    </button>
  );
}
