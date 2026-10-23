import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { noterConnexion } from "@/lib/journal-connexion";
import { createClient } from "@/lib/supabase/server";

// Lien d'invitation ou de connexion qui fonctionne même ouvert sur un autre appareil
// (modèles d'e-mail Supabase réglés sur /auth/confirm?token_hash=...&type=...).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    await noterConnexion(data.user?.email ?? null, error ? "lien-refuse" : "connexion-reussie", error ? `confirm : ${error.message}` : "confirm");
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/connexion?erreur=lien-invalide`);
}
