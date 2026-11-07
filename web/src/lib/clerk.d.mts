import type { Card } from "./types";

export const MODEL_URL: string;

export type ClerkKeys = {
  x25519Secret: Uint8Array;
  signingSecret: Uint8Array;
  encryption_key: string;
  signer: string;
};
export function clerkKeys(seedHex: string): ClerkKeys;
export function modelRequest(caseFile: string, document: string): string;
export function parseVerdict(content: string, claim: string, nonce: string): Card;
export function signCard(keys: ClerkKeys, message: string): string;
export function review(
  input: { fund: string; claim: string; envelope: string },
  net: {
    keys: ClerkKeys;
    view: (method: string, args: Record<string, unknown>) => Promise<unknown>;
    askModel: (body: string) => Promise<string>;
  },
): Promise<{ card: Card; signature: string }>;
