import { signerLiens } from "@/lib/production";
import { getClient } from "@/lib/session";
import { Diaporama } from "./diaporama";

// Galerie : la photo de départ de chaque plan, du premier au dernier, pour voir le film avant de le générer
export default async function PageGalerie({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getClient();
  const [{ data: projet }, { data: scenes }] = await Promise.all([
    supabase.from("projects").select("aspect_ratio").eq("id", id).single(),
    supabase
      .from("scenes")
      .select("id, image_path, voiceover_text, duration_s, lieu, cadrage, angle")
      .eq("project_id", id)
      .order("position"),
  ]);
  const plans = scenes ?? [];
  const liens = await signerLiens(
    supabase,
    plans.map((p) => p.image_path),
  );
  const images = plans.map((p, i) => ({
    numero: i + 1,
    src: p.image_path ? (liens.get(p.image_path) ?? null) : null,
    voix: p.voiceover_text ?? "",
    duree: Number(p.duration_s) || 5,
    detail: [p.lieu, p.cadrage, p.angle].filter(Boolean).join(" · "),
  }));

  return (
    <section className="carte flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Galerie des photos</h2>
        <p className="text-sm text-sourdine">
          {images.filter((p) => p.src).length} photos sur {images.length} plans. « Lecture » fait défiler les photos à la
          durée de chaque plan, avec la voix off en sous-titre : un aperçu du futur film.
        </p>
      </div>
      <Diaporama images={images} format={projet?.aspect_ratio ?? "16:9"} />
    </section>
  );
}
