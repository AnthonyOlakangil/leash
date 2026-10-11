import { parseAbi } from "viem";

export const AUSD_ADDRESS = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC" as const;
export const CHAIN_ID = 84532 as const;
export const X402_NETWORK = "eip155:84532" as const;
export const AUSD_DOMAIN_NAME = "Agora Dollar" as const;
export const AUSD_DOMAIN_VERSION = "1" as const;
export const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267" as const;

/** Verified live on Base Sepolia at 14:30 PT: decimals 6, domain "Agora Dollar"/"1"/84532. Always re-read at boot. */
export const ausdAbi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const createChildTypes = {
  CreateChild: [
    { name: "parentId", type: "uint256" },
    { name: "key", type: "address" },
    { name: "cap", type: "uint256" },
    { name: "maxPerCall", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "restricted", type: "bool" },
    { name: "payeesHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const pauseChildTypes = {
  PauseChild: [
    { name: "target", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const leashDomain = (wallet: `0x${string}`) =>
  ({ name: "Leash", version: "1", chainId: CHAIN_ID, verifyingContract: wallet }) as const;
