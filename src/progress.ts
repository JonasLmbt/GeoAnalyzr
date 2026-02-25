export type LoadingProgress = {
  phase: string;
  current?: number;
  total?: number;
};

const KEY = "__gaLoadingProgress";

export function setLoadingProgress(p: LoadingProgress | null): void {
  try {
    (globalThis as any)[KEY] = p;
  } catch {
    // ignore
  }
}

export function getLoadingProgress(): LoadingProgress | null {
  try {
    const v = (globalThis as any)[KEY];
    if (!v || typeof v !== "object") return null;
    const phase = typeof (v as any).phase === "string" ? (v as any).phase : "";
    if (!phase) return null;
    const current = typeof (v as any).current === "number" ? (v as any).current : undefined;
    const total = typeof (v as any).total === "number" ? (v as any).total : undefined;
    return { phase, current, total };
  } catch {
    return null;
  }
}

