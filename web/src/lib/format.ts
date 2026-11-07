import { D } from "./config";
import type { Card, Claim, ClaimStatus, Route } from "./types";

const UNIT = 10 ** D.tokenDecimals;

export function usd(amount: string | bigint | number, digits = 0) {
  const value = Number(amount) / UNIT;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits === 0 && !Number.isInteger(value) ? 2 : digits,
  });
}

export const toUnits = (dollars: number) => BigInt(Math.round(dollars * UNIT)).toString();
export const fromUnits = (amount: string) => Number(amount) / UNIT;

export const shortHex = (hex: string, n = 6) => (hex.length > n * 2 + 1 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex);

export const shortAccount = (id: string) => {
  if (/^[0-9a-f]{64}$/.test(id)) return shortHex(id, 5);
  return id.length > 30 ? `${id.split(".")[0]}…` : id;
};

export function dateOf(ns: string) {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(ns: string) {
  const secs = Math.max(0, Math.round((Date.now() - Number(BigInt(ns) / 1_000_000n)) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function secondsLeft(deadlineNs: string) {
  return Math.ceil((Number(BigInt(deadlineNs) / 1_000_000n) - Date.now()) / 1000);
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  AwaitingReview: "Being read",
  VetoWindow: "Veto window",
  PanelVoting: "With a panel",
  NeedsCouncil: "Going to council",
  Filing: "Going to council",
  CouncilVote: "With the council",
  Approved: "Approved",
  Paying: "Paying",
  Settling: "Paying",
  Paid: "Paid",
  Rejected: "Declined",
};

export const ROUTE_LABEL: Record<Route, string> = {
  Auto: "Automatic, after a veto window",
  Panel: "Panel of members",
  Council: "DAO council",
};

export const CATEGORY_LABEL: Record<string, string> = {
  medical: "Medical",
  housing: "Housing",
  funeral: "Funeral",
  income: "Lost income",
  food: "Food",
  legal: "Legal",
  safety: "Personal safety",
  other: "Other",
};

export const DOCUMENT_LABEL: Record<string, string> = {
  bill: "A bill",
  letter: "A letter",
  notice: "A notice",
  receipt: "A receipt",
  statement: "A statement",
  other: "Another document",
  none: "No real document",
};

export const AMOUNT_LABEL: Record<string, string> = {
  yes: "Matches the amount",
  partly: "Partly matches",
  no: "Does not match",
  unknown: "Could not tell",
};

export const ASSESSMENT_LABEL: Record<string, string> = {
  supported: "Supports the claim",
  unclear: "Unclear",
  unsupported: "Does not support it",
};

export function cardLines(card: Card) {
  return [
    ["Kind of need", CATEGORY_LABEL[card.category] ?? card.category],
    ["Document", DOCUMENT_LABEL[card.document] ?? card.document],
    ["Recent", card.recent ? "Dated in the last 90 days" : "Older, or no date"],
    ["Amount", AMOUNT_LABEL[card.amount_matches] ?? card.amount_matches],
    ["Overall", ASSESSMENT_LABEL[card.assessment] ?? card.assessment],
  ] as const;
}

export const isOpen = (c: Claim) => c.status !== "Paid" && c.status !== "Rejected";
