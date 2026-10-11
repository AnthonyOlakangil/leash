import { type Address, type Hex, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AUSD_ADDRESS, AUSD_DOMAIN_NAME, AUSD_DOMAIN_VERSION, CHAIN_ID, ausdAbi } from "@leash/abi";
import { ownerKey, relayerKey, rpcUrl } from "./config.js";

export const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl()) });

function walletFor(key: Hex | undefined, label: string) {
  if (!key) throw new Error(`${label} private key is not set in .env`);
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: baseSepolia, transport: http(rpcUrl()) }) };
}
let _relayer: ReturnType<typeof walletFor> | undefined;
let _owner: ReturnType<typeof walletFor> | undefined;
export const relayer = () => (_relayer ??= walletFor(relayerKey(), "RELAYER"));
export const owner = () => (_owner ??= walletFor(ownerKey(), "DEPLOYER"));

/** Serialize sends per signer so concurrent requests cannot collide on nonce. */
export function makeMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}
export const relayerLock = makeMutex();
export const ownerLock = makeMutex();

export type AusdInfo = { domain: { name: string; version: string; chainId: number; verifyingContract: Address }; decimals: number };
let ausdInfo: AusdInfo | undefined;
export const getAusdInfo = () => {
  if (!ausdInfo) throw new Error("AUSD info not loaded; boot verification has not completed");
  return ausdInfo;
};

/** Boot check: AUSD eip712Domain must be ("Agora Dollar","1",84532,AUSD). Fails loudly. */
export async function verifyAusdAtBoot(): Promise<AusdInfo> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const [dom, decimals] = await Promise.all([
        publicClient.readContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "eip712Domain" }),
        publicClient.readContract({ address: AUSD_ADDRESS, abi: ausdAbi, functionName: "decimals" }),
      ]);
      const [, name, version, chainId, verifyingContract] = dom;
      if (
        name !== AUSD_DOMAIN_NAME ||
        version !== AUSD_DOMAIN_VERSION ||
        Number(chainId) !== CHAIN_ID ||
        verifyingContract.toLowerCase() !== AUSD_ADDRESS.toLowerCase()
      ) {
        throw new Error(
          `FATAL AUSD eip712Domain MISMATCH: on-chain (${name}, ${version}, ${chainId}, ${verifyingContract}) vs expected (${AUSD_DOMAIN_NAME}, ${AUSD_DOMAIN_VERSION}, ${CHAIN_ID}, ${AUSD_ADDRESS})`,
        );
      }
      ausdInfo = { domain: { name, version, chainId: Number(chainId), verifyingContract }, decimals: Number(decimals) };
      return ausdInfo;
    } catch (e) {
      if ((e as Error).message.startsWith("FATAL")) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`FATAL could not read AUSD eip712Domain from RPC: ${(lastErr as Error)?.message}`);
}
