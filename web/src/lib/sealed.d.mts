export const MODEL: string;
export const MAX_TOKENS: number;
export const CASE_SEPARATOR: string;
export const MAX_DOCUMENT_BYTES: number;
export const PROMPT: string;
export function sha256hex(x: string | Uint8Array): string;
export function encryptTo(
  recipientEdPubHex: string,
  plaintext: string,
  ephSecret?: Uint8Array,
  nonce?: Uint8Array,
): { envelope: string; ephSecretHex: string };
export function openWith(x25519Secret: Uint8Array, envelopeHex: string): { keyHex: string; plaintext: string };
export function newClient(): { pubHex: string; x25519Secret: Uint8Array };
export function systemMessage(caseFile: string): string;
export function buildRequest(p: { model?: string; systemEnvelope: string; evidenceEnvelope: string; maxTokens?: number }): string;
export function maskDetails(text: string): string;
