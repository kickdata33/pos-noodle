import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * firebase-admin (via jwks-rsa -> jose) ships an ESM-only module that its own CommonJS code
   * `require()`s internally. Next's bundler tries to trace and bundle it into the serverless
   * function, which hits that require(ESM) incompatibility and crashes at runtime with
   * ERR_REQUIRE_ESM — reliably reproduced on Vercel, though not in local `next dev`, which
   * resolves node_modules without that bundling step.
   *
   * Listing it here tells Next to leave firebase-admin as a plain `require()` from
   * node_modules at runtime instead of bundling it, which sidesteps the ESM/CJS conflict
   * entirely. This is the fix Next.js documents for this exact case.
   */
  serverExternalPackages: ["firebase-admin"],
};

export default nextConfig;
