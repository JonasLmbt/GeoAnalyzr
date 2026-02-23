export type ConsoleLevel = "log" | "info" | "warn" | "error";

export type ConsoleEntry = {
  ts: number;
  level: ConsoleLevel;
  message: string;
};

type Listener = () => void;

const MAX_ENTRIES = 800;

const entries: ConsoleEntry[] = [];
const listeners = new Set<Listener>();

const pad = (n: number, w: number) => String(n).padStart(w, "0");

export function formatConsoleEntry(e: ConsoleEntry): string {
  const d = new Date(e.ts);
  const hh = pad(d.getHours(), 2);
  const mm = pad(d.getMinutes(), 2);
  const ss = pad(d.getSeconds(), 2);
  const ms = pad(d.getMilliseconds(), 3);
  const lvl = e.level.toUpperCase().padEnd(5, " ");
  return `[${hh}:${mm}:${ss}.${ms}] ${lvl} ${e.message}`;
}

function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

function describeError(err: unknown): string {
  if (!err) return "";
  if (err instanceof Error) {
    const stack = typeof err.stack === "string" && err.stack.trim().length ? `\n${err.stack}` : "";
    return `${err.name}: ${err.message}${stack}`;
  }
  try {
    return String(err);
  } catch {
    return "<unprintable error>";
  }
}

export const analysisConsole = {
  entries,
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  clear(): void {
    entries.splice(0, entries.length);
    emit();
  },
  push(level: ConsoleLevel, message: string, err?: unknown): void {
    const full = err ? `${message}\n${describeError(err)}` : message;
    entries.push({ ts: Date.now(), level, message: String(full ?? "") });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    emit();
  },
  log(message: string): void {
    this.push("log", message);
  },
  info(message: string): void {
    this.push("info", message);
  },
  warn(message: string): void {
    this.push("warn", message);
  },
  error(message: string, err?: unknown): void {
    this.push("error", message, err);
  }
};

