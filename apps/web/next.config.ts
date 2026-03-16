import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@docupilot/supabase", "@docupilot/parser", "@docupilot/generator"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
