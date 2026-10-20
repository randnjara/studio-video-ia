import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;

// Permet d'utiliser les variables Cloudflare pendant `npm run dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
