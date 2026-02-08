import { db } from "./db";

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
