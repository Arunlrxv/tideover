"use client";

// Talks to the prover worker. The secret stays on this device.
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker() {
  if (!worker) {
    worker = new Worker("/zk/worker.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error));
    };
  }
  return worker;
}

function ask<T>(op: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ id, op, payload });
  });
}

export const newSecret = () => ask<string>("newSecret");
export const commitmentOf = (secret: string) => ask<string>("commitment", { secret });

export type ClaimRequest = {
  secret: string;
  fund: string;
  cycle: number;
  tier: number;
  period: number;
  min_tier: number;
  amount: string;
  payout: string;
  evidence_sha256: string;
  position: number;
  leaves: string[];
};

export type ClaimProof = { proof: string; root: string; period: number; min_tier: number; nullifier: string; millis: number };
export const proveClaim = (request: ClaimRequest) => ask<ClaimProof>("prove", { request });

export type AuditRequest = {
  proof: string;
  root: string;
  period: number;
  min_tier: number;
  nullifier: string;
  fund: string;
  cycle: number;
  amount: string;
  payout: string;
  evidence_sha256: string;
};
export const auditClaim = (request: AuditRequest) => ask<boolean>("audit", { request });
