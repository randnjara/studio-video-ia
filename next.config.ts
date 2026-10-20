import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Les photos des plans passent par les formulaires (10 Mo maximum)
  experimental: { serverActions: { bodySizeLimit: "11mb" } },
};

export default nextConfig;

// Permet d'utiliser les variables Cloudflare pendant `npm run dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
