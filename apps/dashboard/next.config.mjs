import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
// Repo-root .env is server-side only. Nothing here is exposed to the browser.
dotenv.config({ path: path.resolve(here, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: false, // SSE proxy must not be buffered by gzip
  transpilePackages: ["@leash/abi"],
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;
