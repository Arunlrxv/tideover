import type { Card } from "./types";

export const MODEL: string;
export const MAX_TOKENS: number;
export const CASE_SEPARATOR: string;
export const MAX_DOCUMENT_BYTES: number;
export const MAX_ENVELOPE_CHARS: number;
export const PROMPT: string;
export function sha256hex(x: string | Uint8Array): string;
export function sealTo(clerkKeyHex: string, plaintext: string, ephSecret?: Uint8Array, nonce?: Uint8Array): string;
export function openEnvelope(x25519Secret: Uint8Array, envelopeHex: string): string;
export function sealedPayload(p: { fund: string; amount: string; payout: string; document: string }): string;
export function cardMessage(p: {
  fund: string;
  claim: string;
  nonce: string;
  evidenceSha256: string;
  amount: string;
  payout: string;
  card: Card;
}): string;
export function maskDetails(text: string): string;
