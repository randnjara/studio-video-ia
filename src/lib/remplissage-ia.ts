import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// « ✨ Remplir le tableau automatiquement » : quand le secret ANTHROPIC_API_KEY est présent dans Cloudflare, la consigne du
// tableau est envoyée à Claude, qui rend le fichier CSV ; sinon, copier-coller dans ChatGPT ou Claude comme avant.
// Le CSV rendu passe ensuite par l'aperçu et les vérifications de l'import (minutage audio compris).
export const remplissageDisponible = () => Boolean(process.env.ANTHROPIC_API_KEY);

const MODELE = "claude-opus-5-5";

export async function remplirParClaude(consigne: string, fichier: string): Promise<{ csv: string } | { erreur: string }> {
  if (!remplissageDisponible()) return { erreur: "La clé ANTHROPIC_API_KEY n'est pas configurée dans Cloudflare." };
  const client = new Anthropic();
  try {
    // Long tableau (souvent plus de 20 000 jetons) : en flux, pour ne pas dépasser le délai d'une requête
    const message = await client.beta.messages
      .stream({
        model: MODELE,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "high" },
        system:
          "Tu remplis le tableau des plans d'un studio vidéo. Réponds uniquement avec le fichier CSV complet demandé, dans un seul bloc ```csv, sans aucun autre texte avant ni après.",
        messages: [
          {
            role: "user",
            content: `${consigne}\n\n=== FICHIER À REMPLIR (${fichier.split("\n").length - 1} lignes) ===\n${fichier}\n\nRends le fichier complet, toutes les lignes, dans un seul bloc \`\`\`csv (supprime la ligne EXEMPLE).`,
          },
        ],
      })
      .finalMessage();
    if (message.stop_reason === "refusal") return { erreur: "Claude a refusé de remplir ce tableau. Utilisez le copier-coller." };
    const texte = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    if (message.stop_reason === "max_tokens") return { erreur: "Le tableau est trop long pour être rempli d'un coup : utilisez le copier-coller." };
    const csv = (texte.match(/```(?:csv)?\s*\n([\s\S]*?)```/)?.[1] ?? texte).trim();
    if (!csv.includes(";")) return { erreur: "Claude n'a pas rendu de tableau lisible. Réessayez ou utilisez le copier-coller." };
    return { csv };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { erreur: "Clé ANTHROPIC_API_KEY refusée : vérifiez-la dans Cloudflare." };
    if (e instanceof Anthropic.RateLimitError) return { erreur: "Claude est très demandé en ce moment : réessayez dans une minute." };
    if (e instanceof Anthropic.APIError) return { erreur: `Claude a répondu ${e.status ?? "?"} : ${e.message.slice(0, 200)}` };
    return { erreur: `Remplissage impossible : ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` };
  }
}
