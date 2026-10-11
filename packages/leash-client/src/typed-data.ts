import {
  type Address,
  type Hex,
  hashTypedData,
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AUSD_ADDRESS,
  AUSD_DOMAIN_NAME,
  AUSD_DOMAIN_VERSION,
  CHAIN_ID,
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  transferWithAuthorizationTypes,
} from "@leash/abi";

export { TRANSFER_WITH_AUTHORIZATION_TYPEHASH, transferWithAuthorizationTypes };

/** Canonical type string whose keccak256 is TRANSFER_WITH_AUTHORIZATION_TYPEHASH. */
export const TRANSFER_WITH_AUTHORIZATION_TYPE_STRING =
  "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)";

export type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

/** The AUSD token domain. NEVER name "AUSD": the live token reports "Agora Dollar". */
export function ausdDomain(verifyingContract: Address = AUSD_ADDRESS): Eip712Domain {
  return { name: AUSD_DOMAIN_NAME, version: AUSD_DOMAIN_VERSION, chainId: CHAIN_ID, verifyingContract };
}

export type TransferAuthorization = {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
};

/** Same shape, all decimal strings: what crosses HTTP/JSON. */
export type TransferAuthorizationJson = {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

/** Random 32-byte nonce. Never a counter: the nonce namespace is shared by every node (authorizer = the wallet). */
export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

/**
 * Build the authorization. validAfter = now - 5 (AUSD needs block.timestamp > validAfter strictly),
 * validBefore = now + 120, random nonce. `from` is the LeashWallet, not the agent key.
 */
export function buildTransferAuthorization(args: {
  from: Address;
  to: Address;
  value: bigint;
  nowSeconds?: number;
  nonce?: Hex;
}): TransferAuthorization {
  const now = BigInt(args.nowSeconds ?? Math.floor(Date.now() / 1000));
  return {
    from: args.from,
    to: args.to,
    value: args.value,
    validAfter: now - 5n,
    validBefore: now + 120n,
    nonce: args.nonce ?? randomNonce(),
  };
}

export function authorizationToJson(a: TransferAuthorization): TransferAuthorizationJson {
  return {
    from: a.from,
    to: a.to,
    value: a.value.toString(),
    validAfter: a.validAfter.toString(),
    validBefore: a.validBefore.toString(),
    nonce: a.nonce,
  };
}

export function authorizationFromJson(a: TransferAuthorizationJson): TransferAuthorization {
  return {
    from: a.from,
    to: a.to,
    value: BigInt(a.value),
    validAfter: BigInt(a.validAfter),
    validBefore: BigInt(a.validBefore),
    nonce: a.nonce,
  };
}

/** The viem typed-data object. Shared by signing, signer recovery in the facilitator, and tests. */
export function buildTransferTypedData(domain: Eip712Domain, authorization: TransferAuthorization) {
  return {
    domain,
    types: transferWithAuthorizationTypes,
    primaryType: "TransferWithAuthorization" as const,
    message: authorization,
  };
}

/** EIP-712 digest AUSD will compute: keccak256("\x19\x01" || DOMAIN_SEPARATOR || structHash). */
export function transferDigest(domain: Eip712Domain, authorization: TransferAuthorization): Hex {
  return hashTypedData(buildTransferTypedData(domain, authorization));
}

/** Sign with an agent node key. Returns a 65-byte (r,s,v) signature. */
export async function signTransferAuthorization(args: {
  nodePrivateKey: Hex;
  domain: Eip712Domain;
  authorization: TransferAuthorization;
}): Promise<Hex> {
  const account = privateKeyToAccount(args.nodePrivateKey);
  return account.signTypedData(buildTransferTypedData(args.domain, args.authorization));
}

export const typehashOfTypeString = (): Hex => keccak256(toHex(TRANSFER_WITH_AUTHORIZATION_TYPE_STRING));
