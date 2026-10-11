import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { EVENTS_FILE } from "./config.js";

export type LeashEvent = {
  id: string;
  ts: number;
  kind: "paid" | "blocked" | "bypass" | "delegation" | "admin";
  nodeId?: string;
  payee?: Address;
  payeeLabel?: string;
  amount?: string;
  txHash?: Hex;
  error?: { name: string; args: string[]; reason: string };
  detail?: string;
  scripted?: boolean;
};

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(e: Omit<LeashEvent, "id" | "ts">): LeashEvent {
  const ev: LeashEvent = { id: randomUUID(), ts: Date.now(), ...e };
  try {
    mkdirSync(dirname(EVENTS_FILE), { recursive: true });
    appendFileSync(EVENTS_FILE, JSON.stringify(ev) + "\n");
  } catch (err) {
    console.warn("[events] could not append to events.jsonl:", (err as Error).message);
  }
  bus.emit("event", ev);
  return ev;
}

export function lastEvents(n = 200): LeashEvent[] {
  if (!existsSync(EVENTS_FILE)) return [];
  const lines = readFileSync(EVENTS_FILE, "utf8").split("\n").filter(Boolean);
  const out: LeashEvent[] = [];
  for (const l of lines.slice(-n)) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}
