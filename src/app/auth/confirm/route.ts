import { NextResponse, type NextRequest } from "next/server";

// Lien d'invitation ou de connexion (?token_hash=...&type=...). Le lien ne sert qu'une fois : on ne le consomme
// pas ici, car les aperçus automatiques (WhatsApp, Gmail, Google…) ouvrent le lien avant la personne.
// La page suivante demande un clic sur « Me connecter », que ces robots ne font pas.
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/connexion/lien";
  return NextResponse.redirect(url);
}
