import { db } from "./db";

const AUTH_META_KEY = "auth";

export async function getNcfaToken(): Promise<string | undefined> {
  const row = await db.meta.get(AUTH_META_KEY);
  const token = (row?.value as any)?.ncfa;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
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

