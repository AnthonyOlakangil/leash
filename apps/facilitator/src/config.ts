import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Address, Hex } from "viem";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const ENV_PATH = process.env.LEASH_ENV_FILE ? resolve(REPO_ROOT, process.env.LEASH_ENV_FILE) : resolve(REPO_ROOT, ".env");
dotenv.config({ path: ENV_PATH });

const DEPLOYMENT_PATH = resolve(REPO_ROOT, "packages/abi/deployments/base-sepolia.json");

/** Re-read .env and the deployment json at call time so a late deploy needs no restart. Never logs values. */
function freshEnv(): Record<string, string | undefined> {
  try {
    if (existsSync(ENV_PATH)) return { ...process.env, ...dotenv.parse(readFileSync(ENV_PATH)) };
  } catch {
    /* fall through */
  }
  return process.env;
}

export function getWallet(): Address | undefined {
  const env = freshEnv();
  if (env.LEASH_WALLET && /^0x[0-9a-fA-F]{40}$/.test(env.LEASH_WALLET)) return env.LEASH_WALLET as Address;
  try {
    const dep = JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8")) as { leashWallet?: string };
    if (dep.leashWallet && /^0x[0-9a-fA-F]{40}$/.test(dep.leashWallet)) return dep.leashWallet as Address;
  } catch {
    /* ignore */
  }
  return undefined;
}

export const env = (k: string): string | undefined => freshEnv()[k] || undefined;

export const rpcUrl = () => env("BASE_SEPOLIA_RPC_URL") || "https://sepolia.base.org";
export const relayerKey = () => env("RELAYER_PRIVATE_KEY") as Hex | undefined;
export const ownerKey = () => env("DEPLOYER_PRIVATE_KEY") as Hex | undefined;
export const adminToken = () => env("ADMIN_TOKEN");
export const PORT = Number(process.env.FACILITATOR_PORT || 4020);
export const EVENTS_FILE = resolve(REPO_ROOT, "data/events.jsonl");

/** Payee labels for the dashboard, from env addresses. */
export function payeeLabel(addr?: string): string | undefined {
  if (!addr) return undefined;
  const a = addr.toLowerCase();
  if (a === env("PAYEE_SEARCH_ADDRESS")?.toLowerCase()) return "Search API";
  if (a === env("PAYEE_SCRAPE_ADDRESS")?.toLowerCase()) return "Scrape API";
  if (a === env("ATTACKER_ADDRESS")?.toLowerCase()) return "ATTACKER";
  return undefined;
}
