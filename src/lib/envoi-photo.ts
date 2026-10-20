"use client";

import { createClient } from "@/lib/supabase/client";

const COTE_MAX = 1920;

// Réduit les grandes photos (souvent 4000 px sur téléphone) avant l'envoi : plus rapide, même rendu vidéo.
async function reduire(fichier: File): Promise<Blob> {
  try {
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    if (echelle === 1 && fichier.size < 3 * 1024 * 1024 && fichier.type === "image/jpeg") return fichier;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("conversion"))), "image/jpeg", 0.9));
  } catch {
    return fichier;
  }
}

// Envoie la photo directement du navigateur vers le stockage du projet et renvoie son chemin.
export async function envoyerPhoto(projectId: string, fichier: File): Promise<string> {
  if (!fichier.type.startsWith("image/")) throw new Error(`« ${fichier.name} » n'est pas une image.`);
  const contenu = await reduire(fichier);
  const type = contenu.type || "image/jpeg";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const chemin = `${projectId}/photos/${crypto.randomUUID()}.${ext}`;
  const { error } = await createClient().storage.from("medias").upload(chemin, contenu, { contentType: type });
  if (error) throw new Error(`Envoi de « ${fichier.name} » impossible : ${error.message}`);
  return chemin;
}
