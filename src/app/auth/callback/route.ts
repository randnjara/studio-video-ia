import { NextResponse, type NextRequest } from "next/server";
import { noterConnexion } from "@/lib/journal-connexion";
import { createClient } from "@/lib/supabase/server";

// Lien de connexion ouvert dans le même navigateur que la demande.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    await noterConnexion(data.user?.email ?? null, error ? "lien-refuse" : "connexion-reussie", error ? `callback : ${error.message}` : "callback");
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/connexion?erreur=lien-invalide`);
}
