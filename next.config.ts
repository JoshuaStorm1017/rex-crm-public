import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon. Next already externalizes it by default;
  // listed here so a future Next version cannot quietly bundle it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
