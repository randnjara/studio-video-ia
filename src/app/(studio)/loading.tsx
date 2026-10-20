// Affiché tout de suite pendant le chargement d'une page
export default function Chargement() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy>
      <div className="h-8 w-64 rounded-lg bg-surface-2" />
      <div className="h-40 rounded-xl bg-surface-2" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-28 rounded-xl bg-surface-2" />
        <div className="h-28 rounded-xl bg-surface-2" />
      </div>
    </div>
  );
}
