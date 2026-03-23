export type FetchLogLevel = "info" | "warn" | "error";

export type FetchLogEvent = {
  ts: number;
  kind: string;
  level?: FetchLogLevel;
  msg?: string;
  data?: any;
};

export type FetchLogDoc = {
  schemaVersion: 1;
  phase: "fetch";
  startedAt: number;
  endedAt?: number;
  pageUrl?: string;
  userAgent?: string;
  config?: any;
  summary?: any;
  events: FetchLogEvent[];
};

export function safeError(e: unknown): { name?: string; message: string; stack?: string } {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { message: String(e) };
}

export function shortToken(token: unknown, maxLen = 16): string | undefined {
  if (typeof token !== "string") return undefined;
  const t = token.trim();
  if (!t) return undefined;
  if (t.length <= maxLen) return t;
  return `${t.slice(0, Math.max(4, Math.floor(maxLen / 2)))}…${t.slice(-Math.max(4, Math.floor(maxLen / 2)))}`;
}

export function sampleList<T>(items: T[], head = 10, tail = 10): { total: number; head: T[]; tail: T[] } {
  const total = Array.isArray(items) ? items.length : 0;
  const h = items.slice(0, Math.max(0, head));
  const t = total > tail ? items.slice(Math.max(0, total - Math.max(0, tail))) : items.slice();
  return { total, head: h, tail: t };
}

