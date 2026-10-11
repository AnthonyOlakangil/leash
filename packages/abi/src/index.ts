import deployment from "../deployments/base-sepolia.json" with { type: "json" };
export { leashWalletAbi } from "./LeashWallet.js";
export * from "./ausd.js";
export { deployment };
export type Deployment = typeof deployment;
