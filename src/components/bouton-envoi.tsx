"use client";

import { useFormStatus } from "react-dom";

// Bouton de formulaire qui se bloque et affiche « en cours » pendant l'envoi, pour éviter les doubles clics.
export function BoutonEnvoi({
  children,
  enCours = "Un instant…",
  className = "bouton",
  confirmer,
  disabled,
}: {
  children: React.ReactNode;
  enCours?: string;
  className?: string;
  confirmer?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(e) => {
        if (confirmer && !window.confirm(confirmer)) e.preventDefault();
      }}
    >
      {pending && <Roue />}
      {pending ? enCours : children}
    </button>
  );
}

export function Roue() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
