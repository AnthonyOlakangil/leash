// Shapes mirror contracts/src/ILeashWallet.sol and docs/INTERFACES.md. bigint amounts are decimal strings.
export type UiNode = {
  id: number; key: string; parent: string; depth: string; cap: string; spent: string;
  maxPerCall: string; expiry: string; paused: boolean; restricted: boolean;
};
export type ChainLog =
  | { kind: "Paid"; id: string; to: string; value: string; nonce: string; txHash: string; ts: number; logIndex: number }
  | { kind: "NodeCreated"; id: string; parent: string; key: string; cap: string; maxPerCall: string; expiry: string; txHash: string; ts: number; logIndex: number }
  | { kind: "NodePaused"; id: string; by: string; txHash: string; ts: number; logIndex: number }
  | { kind: "NodeUnpaused"; id: string; txHash: string; ts: number; logIndex: number }
  | { kind: "CapRaised"; id: string; oldCap: string; newCap: string; txHash: string; ts: number; logIndex: number };
export type LeashEvent = {
  id: string; ts: number;
  kind: "paid" | "blocked" | "bypass" | "delegation" | "admin";
  nodeId?: string; payee?: string; payeeLabel?: string; amount?: string; txHash?: string;
  error?: { name: string; args: string[]; reason: string };
  detail?: string; scripted?: boolean;
};
export type ChainState = {
  mode: "live" | "mock";
  wallet?: string; decimals: number; balance?: string;
  labels: Record<string, string>; // lowercase address -> label
  names?: Record<string, string>; // lowercase node key address -> agent name (addresses only, never keys)
  nodes: UiNode[]; logs: ChainLog[];
  error?: string;
};
export const BASESCAN_TX = "https://sepolia.basescan.org/tx/";
