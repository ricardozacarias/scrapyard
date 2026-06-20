import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// Monorepo root (two levels up from apps/web).
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const config: NextConfig = {
  // The DB package is shipped as TypeScript source, so Next must transpile it.
  transpilePackages: ["@scrapyard/db"],
  // Keep the Neon driver out of the bundle (it's server-only).
  serverExternalPackages: ["@neondatabase/serverless"],
  // We're in a pnpm monorepo; pin file tracing to the repo root.
  outputFileTracingRoot: repoRoot,
};

export default config;
