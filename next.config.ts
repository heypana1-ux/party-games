import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The service worker must never be served from a stale cache, or a released
  // fix could sit unused on a player's phone for a whole evening.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
