import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashTypedData, keccak256, encodePacked, recoverAddress, type Address, type Hex } from "viem";
import { createChildTypes, leashDomain, pauseChildTypes } from "@leash/abi";
import { ausdDomain, buildTransferTypedData } from "../src/typed-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(resolve(here, "../../abi/golden/digest.json"), "utf8"));

test("golden: TransferWithAuthorization digest matches Solidity", async () => {
  const t = g.transferWithAuthorization;
  const td = buildTransferTypedData(ausdDomain(t.ausd as Address), {
    from: t.from, to: t.to, value: BigInt(t.value), validAfter: BigInt(t.validAfter), validBefore: BigInt(t.validBefore), nonce: t.nonce,
  });
  const digest = hashTypedData(td);
  assert.equal(digest, t.digest);
  assert.equal((await recoverAddress({ hash: digest, signature: t.signature as Hex })).toLowerCase(), g.signer.toLowerCase());
});

test("golden: CreateChild digest (incl. payeesHash) matches Solidity", async () => {
  const c = g.createChild;
  const payeesHash = keccak256(encodePacked(["address[]"], [c.payees]));
  assert.equal(payeesHash, c.payeesHash);
  const digest = hashTypedData({
    domain: leashDomain(c.wallet as Address),
    types: createChildTypes,
    primaryType: "CreateChild",
    message: {
      parentId: BigInt(c.parentId), key: c.key, cap: BigInt(c.cap), maxPerCall: BigInt(c.maxPerCall), expiry: BigInt(c.expiry),
      restricted: c.restricted, payeesHash, nonce: BigInt(c.nonce), deadline: BigInt(c.deadline),
    },
  });
  assert.equal(digest, c.digest);
  assert.equal((await recoverAddress({ hash: digest, signature: c.signature as Hex })).toLowerCase(), g.signer.toLowerCase());
});

test("golden: PauseChild digest matches Solidity", async () => {
  const p = g.pauseChild;
  const digest = hashTypedData({
    domain: leashDomain(p.wallet as Address),
    types: pauseChildTypes,
    primaryType: "PauseChild",
    message: { target: BigInt(p.target), nonce: BigInt(p.nonce), deadline: BigInt(p.deadline) },
  });
  assert.equal(digest, p.digest);
  assert.equal((await recoverAddress({ hash: digest, signature: p.signature as Hex })).toLowerCase(), g.signer.toLowerCase());
});
