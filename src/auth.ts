import { db } from "./db";
import { httpGetJson } from "./http";

const AUTH_META_KEY = "auth";

export function readNcfaFromDocumentCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const raw = typeof document.cookie === "string" ? document.cookie : "";
  if (!raw) return undefined;
  const parts = raw.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== "_ncfa") continue;
    const value = rest.join("=").trim();
    if (value) return value;
  }
  return undefined;
}

export async function getNcfaToken(): Promise<string | undefined> {
  const row = await db.meta.get(AUTH_META_KEY);
  const token = (row?.value as any)?.ncfa;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

export async function getResolvedNcfaToken(): Promise<{ token?: string; source: "stored" | "cookie" | "none" }> {
  const stored = await getNcfaToken();
  if (stored) return { token: stored, source: "stored" };
  const cookie = readNcfaFromDocumentCookie();
  if (cookie) return { token: cookie, source: "cookie" };
  return { source: "none" };
}

export async function setNcfaToken(token?: string): Promise<void> {
  const clean = typeof token === "string" ? token.trim() : "";
  if (!clean) {
    await db.meta.delete(AUTH_META_KEY);
    return;
  }
  await db.meta.put({
    key: AUTH_META_KEY,
    value: { ncfa: clean },
    updatedAt: Date.now()
  });
}

export type NcfaValidationResult = {
  ok: boolean;
  status?: number;
  reason: string;
  source?: "format" | "api" | "network";
};

function basicNcfaFormatCheck(token: string): NcfaValidationResult | undefined {
  const clean = token.trim();
  if (!clean) return { ok: false, reason: "Token is empty.", source: "format" };
  if (clean.length < 20) return { ok: false, reason: "Token looks too short.", source: "format" };
  if (/\s/.test(clean)) return { ok: false, reason: "Token must not contain whitespace.", source: "format" };
  return undefined;
}

export async function validateNcfaToken(token?: string): Promise<NcfaValidationResult> {
  const clean = typeof token === "string" ? token.trim() : "";
  const basic = basicNcfaFormatCheck(clean);
  if (basic) return basic;

  try {
    const res = await httpGetJson("https://www.geoguessr.com/api/v4/feed/private", {
      ncfa: clean,
      forceGm: true
    });
    if (res.status >= 200 && res.status < 300) {
      const hasEntries = Array.isArray(res.data?.entries);
      return hasEntries
        ? { ok: true, status: res.status, reason: "Token accepted by private feed endpoint.", source: "api" }
        : { ok: true, status: res.status, reason: "Token accepted (response shape unexpected).", source: "api" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, reason: "Token rejected (unauthorized).", source: "api" };
    }
    if (res.status === 429) {
      return { ok: false, status: res.status, reason: "Rate-limited while validating token. Try again shortly.", source: "api" };
    }
    return { ok: false, status: res.status, reason: `Validation failed with HTTP ${res.status}.`, source: "api" };
  } catch (e) {
    return {
      ok: false,
      reason: `Validation request failed: ${e instanceof Error ? e.message : String(e)}`,
      source: "network"
    };
  }
}
