import { NextResponse } from "next/server";
import { ChainRefusal } from "./near";

export const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/** Turns a contract's refusal into a response the page can show as it is. */
export async function guarded(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ChainRefusal) return fail(e.message, 409, { hash: e.hash, refused: true });
    return fail(String((e as Error).message ?? e).slice(0, 300), 502);
  }
}

const windows = new Map<string, { start: number; count: number }>();

/** A simple per-instance limit, to keep one visitor from draining the demo's gas. */
export function allow(key: string, perMinute: number) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > 60_000) {
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  w.count += 1;
  return w.count <= perMinute;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

export const isHex = (s: unknown, bytes?: number): s is string =>
  typeof s === "string" && /^[0-9a-f]+$/.test(s) && s.length % 2 === 0 && (bytes === undefined || s.length === bytes * 2);
