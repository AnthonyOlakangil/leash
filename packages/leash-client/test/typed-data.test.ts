import test from "node:test";
import assert from "node:assert/strict";
import { concat, encodeAbiParameters, keccak256, recoverTypedDataAddress, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AUSD_ADDRESS, TRANSFER_WITH_AUTHORIZATION_TYPEHASH } from "@leash/abi";
import {
  TRANSFER_WITH_AUTHORIZATION_TYPE_STRING,
  ausdDomain,
  buildTransferAuthorization,
  buildTransferTypedData,
  randomNonce,
  signTransferAuthorization,
  transferDigest,
} from "../src/typed-data.js";
import { hashDomain } from "viem";

// Live AUSD DOMAIN_SEPARATOR on Base Sepolia (docs/INTERFACES.md, verified 14:30 PT).
const LIVE_DOMAIN_SEPARATOR = "0x5a85328c8aae02b57a5bc1fb1848cb2fb9ccbdc204c554a4db199b13fed1e8bb";
const WALLET = "0x1111111111111111111111111111111111111111" as const;
const PAYEE = "0x2222222222222222222222222222222222222222" as const;

test("TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(type string)", () => {
  assert.equal(keccak256(toHex(TRANSFER_WITH_AUTHORIZATION_TYPE_STRING)), TRANSFER_WITH_AUTHORIZATION_TYPEHASH);
  assert.equal(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267");
});

test("AUSD domain hashes to the live DOMAIN_SEPARATOR (name is 'Agora Dollar', not 'AUSD')", () => {
  const domain = ausdDomain();
  assert.equal(domain.name, "Agora Dollar");
  const sep = hashDomain({
    domain: { ...domain, chainId: BigInt(domain.chainId) },
    types: { EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ] },
  });
  assert.equal(sep, LIVE_DOMAIN_SEPARATOR);
});

test("hashTypedData digest == keccak256(0x1901 || DOMAIN_SEPARATOR || structHash)", () => {
  const auth = buildTransferAuthorization({ from: WALLET, to: PAYEE, value: 20000n, nowSeconds: 1_800_000_000, nonce: `0x${"ab".repeat(32)}` });
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "address" }, { type: "address" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
      ],
      [TRANSFER_WITH_AUTHORIZATION_TYPEHASH, auth.from, auth.to, auth.value, auth.validAfter, auth.validBefore, auth.nonce],
    ),
  );
  const expected = keccak256(concat(["0x1901", LIVE_DOMAIN_SEPARATOR, structHash]));
  assert.equal(transferDigest(ausdDomain(AUSD_ADDRESS), auth), expected);
});

test("timing + nonce rules and signature recovers the node key (not the wallet)", async () => {
  const now = 1_800_000_000;
  const a = buildTransferAuthorization({ from: WALLET, to: PAYEE, value: 1n, nowSeconds: now });
  const b = buildTransferAuthorization({ from: WALLET, to: PAYEE, value: 1n, nowSeconds: now });
  assert.equal(a.validAfter, BigInt(now - 5));
  assert.equal(a.validBefore, BigInt(now + 120));
  assert.match(a.nonce, /^0x[0-9a-f]{64}$/);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(randomNonce(), randomNonce());

  const key = generatePrivateKey();
  const domain = ausdDomain();
  const signature = await signTransferAuthorization({ nodePrivateKey: key, domain, authorization: a });
  assert.equal(signature.length, 2 + 65 * 2);
  const signer = await recoverTypedDataAddress({ ...buildTransferTypedData(domain, a), signature });
  assert.equal(signer, privateKeyToAccount(key).address);
});
