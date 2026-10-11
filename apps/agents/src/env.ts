import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { deployment, AUSD_ADDRESS } from "@leash/abi";
import { type Address, type Hex, isAddress } from "viem";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
export const KEYS_FILE = path.resolve(here, "../.keys.json");
config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

export const DRY_WALLET_PLACEHOLDER = "0x000000000000000000000000000000000000dEaD" as Address;

function addr(name: string, v: string | undefined): Address | undefined {
  if (!v) return undefined;
  if (!isAddress(v)) throw new Error(`${name} is not a valid address`);
  return v as Address;
}

export function loadEnv(dry: boolean) {
  const wallet = addr("LEASH_WALLET", process.env.LEASH_WALLET || deployment.leashWallet || undefined);
  if (!wallet && !dry) {
    throw new Error(
      "LEASH_WALLET is not set (and packages/abi/deployments/base-sepolia.json has no leashWallet). " +
        "LeashWallet is not deployed yet. Deploy it, set LEASH_WALLET in .env, then re-run. (Use --dry to preview offline.)",
    );
  }
  const need = (name: string): string => {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is missing from the repo-root .env`);
    return v;
  };
  const optional = (name: string, fallback: string) => process.env[name] || fallback;
  const rootKey = (dry ? process.env.ROOT_AGENT_PRIVATE_KEY : need("ROOT_AGENT_PRIVATE_KEY")) as Hex | undefined;
  const payeeSearch = addr("PAYEE_SEARCH_ADDRESS", process.env.PAYEE_SEARCH_ADDRESS);
  const payeeScrape = addr("PAYEE_SCRAPE_ADDRESS", process.env.PAYEE_SCRAPE_ADDRESS);
  const attacker = addr("ATTACKER_ADDRESS", process.env.ATTACKER_ADDRESS);
  if (!dry && (!payeeSearch || !payeeScrape)) throw new Error("PAYEE_SEARCH_ADDRESS / PAYEE_SCRAPE_ADDRESS missing from .env");
  return {
    wallet: wallet ?? DRY_WALLET_PLACEHOLDER,
    walletIsPlaceholder: !wallet,
    ausd: addr("AUSD_ADDRESS", process.env.AUSD_ADDRESS) ?? (AUSD_ADDRESS as Address),
    rpcUrl: optional("BASE_SEPOLIA_RPC_URL", "https://sepolia.base.org"),
    facilitatorUrl: optional("FACILITATOR_URL", "http://localhost:4020").replace(/\/$/, ""),
    sellerUrl: optional("SELLER_URL", "http://localhost:4021").replace(/\/$/, ""),
    adminToken: dry ? process.env.ADMIN_TOKEN ?? "" : need("ADMIN_TOKEN"),
    rootKey,
    payeeSearch: payeeSearch ?? ("0x00000000000000000000000000000000000000a1" as Address),
    payeeScrape: payeeScrape ?? ("0x00000000000000000000000000000000000000a2" as Address),
    attacker: attacker ?? ("0x00000000000000000000000000000000000000a3" as Address),
    anthropicKey: process.env.ANTHROPIC_API_KEY,
  };
}
export type Env = ReturnType<typeof loadEnv>;
