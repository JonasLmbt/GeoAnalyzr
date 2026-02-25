export type GmXmlhttpRequest = (details: any) => void;

function getGlobalGmXmlhttpRequest(): unknown {
  const g: any = globalThis as any;
  return g?.GM_xmlhttpRequest ?? g?.GM?.xmlHttpRequest;
}

// In many userscript managers, GM APIs are injected as free variables in the script
// sandbox rather than being attached to `globalThis`. `typeof <identifier>` is safe
// even if the identifier doesn't exist at runtime.
function getSandboxGmXmlhttpRequest(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : undefined;
  } catch {
    return undefined;
  }
}

export function getGmXmlhttpRequest(): GmXmlhttpRequest | undefined {
  const fromGlobal = getGlobalGmXmlhttpRequest();
  if (typeof fromGlobal === "function") return fromGlobal as GmXmlhttpRequest;

  const fromSandbox = getSandboxGmXmlhttpRequest();
  if (typeof fromSandbox === "function") return fromSandbox as GmXmlhttpRequest;

  return undefined;
}

export function hasGmXmlhttpRequest(): boolean {
  return typeof getGmXmlhttpRequest() === "function";
}

