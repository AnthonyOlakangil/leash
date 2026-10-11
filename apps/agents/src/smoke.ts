// P2 smoke: one real paid request and one decoded onchain block, both from the root node key.
import "./env.js";
import { createLeashFetch } from "@leash/client";
import type { Address, Hex } from "viem";

const wallet = process.env.LEASH_WALLET as Address;
const seller = process.env.SELLER_URL || "http://localhost:4021";
const base = { nodePrivateKey: process.env.ROOT_AGENT_PRIVATE_KEY as Hex, wallet, rpcUrl: process.env.BASE_SEPOLIA_RPC_URL! };
const tx = (h?: string) => (h ? `https://sepolia.basescan.org/tx/${h}` : "-");

const paid = await createLeashFetch(base)(`${seller}/search?q=${encodeURIComponent("used alto saxophone Berkeley")}`);
console.log(`[smoke] /search status=${paid.status} paid=${tx(paid.paid?.txHash)} blocked=${paid.blocked?.name ?? "-"}`);

const blocked = await createLeashFetch({ ...base, forceBroadcast: true })(`${seller}/premium-intel`);
console.log(`[smoke] /premium-intel status=${blocked.status} blocked=${blocked.blocked?.name}(${blocked.blocked?.args?.join(",")}) "${blocked.blocked?.reason}" tx=${tx(blocked.blocked?.txHash)}`);
process.exit(paid.paid && blocked.blocked ? 0 : 1);
