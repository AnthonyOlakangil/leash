import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: resolve(REPO_ROOT, ".env") });

export const PORT = Number(process.env.SELLER_PORT || 4021);
export const SELLER_URL = (process.env.SELLER_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
export const FACILITATOR_URL = (process.env.FACILITATOR_URL || "http://localhost:4020").replace(/\/$/, "");
export const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
export const CONTEXT_KEY = process.env.CONTEXT_DEV_API_KEY || "";
