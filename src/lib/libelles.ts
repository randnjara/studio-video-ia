export const STATUTS_PROJET: Record<string, string> = {
  scenario: "Scénario",
  production: "Production des plans",
  montage: "Montage",
  a_valider: "À valider",
  valide: "Validé",
  livre: "Livré",
  archive: "Archivé",
};

export const FORMATS = ["9:16", "16:9", "1:1"] as const;

export function dateCourte(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
