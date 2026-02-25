/* Userscript globals (Tampermonkey / Violentmonkey / Greasemonkey) */

declare const GM_xmlhttpRequest:
  | undefined
  | ((details: {
      method?: string;
      url: string;
      headers?: Record<string, string>;
      data?: any;
      responseType?: "text" | "json" | "arraybuffer" | string;
      timeout?: number;
      onload?: (response: any) => void;
      onerror?: (error: any) => void;
      ontimeout?: () => void;
    }) => void);

declare const GM:
  | undefined
  | {
      xmlHttpRequest?: typeof GM_xmlhttpRequest;
    };

