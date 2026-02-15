type LogoSvgMarkupOptions = {
  size: number;
  idPrefix: string;
  variant?: "full" | "mark" | "light";
  decorative?: boolean;
  ariaLabel?: string;
};

const LOGO_SVG_DEFS = `
  <defs>
    <radialGradient id="bg" cx="30%" cy="20%" r="80%">
      <stop offset="0" stop-color="#7c5cff" stop-opacity="0.38"/>
      <stop offset="55%" stop-color="#0b1020" stop-opacity="1"/>
      <stop offset="100%" stop-color="#060a14" stop-opacity="1"/>
    </radialGradient>
    <linearGradient id="g" x1="70" y1="70" x2="200" y2="200" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7950E5"/>
      <stop offset="0.55" stop-color="#00A2FE"/>
      <stop offset="1" stop-color="#3AE8BD"/>
    </linearGradient>
    <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="14" stdDeviation="12" flood-color="#000" flood-opacity="0.45"/>
    </filter>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
`;

const LOGO_SVG_SHAPES = `
  <path filter="url(#shadow)"
        d="M128 28c-38.7 0-70 31.3-70 70 0 55.3 70 130 70 130s70-74.7 70-130c0-38.7-31.3-70-70-70z"
        fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" stroke-width="4"/>

  <circle cx="128" cy="98" r="46" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>

  <path filter="url(#glow)"
        d="M88 110l26-22 20 16 22-30 30 22"
        fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>

  <g filter="url(#glow)">
    <circle cx="88" cy="110" r="5.5" fill="#7950E5"/>
    <circle cx="114" cy="88" r="5.5" fill="#5f7ff0"/>
    <circle cx="134" cy="104" r="5.5" fill="#00A2FE"/>
    <circle cx="156" cy="74" r="5.5" fill="#22cfe0"/>
    <circle cx="186" cy="96" r="5.5" fill="#3AE8BD"/>
  </g>
`;

const LOGO_SVG_SHAPES_MARK = `
  <path filter="url(#shadow)"
        d="M128 28c-38.7 0-70 31.3-70 70 0 55.3 70 130 70 130s70-74.7 70-130c0-38.7-31.3-70-70-70z"
        fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.24)" stroke-width="4"/>

  <circle cx="128" cy="98" r="46" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.18)" stroke-width="3"/>

  <path filter="url(#glow)"
        d="M88 110l26-22 20 16 22-30 30 22"
        fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>

  <g filter="url(#glow)">
    <circle cx="88" cy="110" r="6.2" fill="#7950E5"/>
    <circle cx="114" cy="88" r="6.2" fill="#5f7ff0"/>
    <circle cx="134" cy="104" r="6.2" fill="#00A2FE"/>
    <circle cx="156" cy="74" r="6.2" fill="#22cfe0"/>
    <circle cx="186" cy="96" r="6.2" fill="#3AE8BD"/>
  </g>
`;

const LOGO_LIGHT_DEFS = `
  <defs>
    <linearGradient id="neon" x1="64" y1="64" x2="196" y2="196" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="0.35" stop-color="#AFA2FF"/>
      <stop offset="0.7" stop-color="#00C8FF"/>
      <stop offset="1" stop-color="#3AE8BD"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
`;

const LOGO_LIGHT_SHAPES = `
  <path d="M128 28c-38.7 0-70 31.3-70 70 0 55.3 70 130 70 130s70-74.7 70-130c0-38.7-31.3-70-70-70z"
        fill="rgba(255,255,255,0.20)" stroke="rgba(255,255,255,0.70)" stroke-width="9"/>

  <circle cx="128" cy="98" r="54" fill="rgba(255,255,255,0.16)" stroke="rgba(255,255,255,0.55)" stroke-width="6"/>

  <path filter="url(#glow)"
        d="M90 110l30-26 26 20 28-36 34 26"
        fill="none" stroke="url(#neon)" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
`;

function replaceAll(haystack: string, needle: string, replacement: string): string {
  return haystack.split(needle).join(replacement);
}

function escapeAttr(value: string): string {
  let v = value;
  v = replaceAll(v, "&", "&amp;");
  v = replaceAll(v, "\"", "&quot;");
  v = replaceAll(v, "<", "&lt;");
  v = replaceAll(v, ">", "&gt;");
  return v;
}

export function logoSvgMarkup(opts: LogoSvgMarkupOptions): string {
  const { size, idPrefix, decorative, ariaLabel } = opts;
  const variant = opts.variant ?? "full";

  let inner = "";
  let ids: readonly string[] = [];
  if (variant === "light") {
    inner = `${LOGO_LIGHT_DEFS.trim()}\n${LOGO_LIGHT_SHAPES.trim()}`.trim();
    ids = ["neon", "glow"];
  } else {
    const bg = variant === "full" ? `<circle cx="128" cy="128" r="112" fill="url(#bg)"/>` : "";
    const shapes = variant === "full" ? LOGO_SVG_SHAPES.trim() : LOGO_SVG_SHAPES_MARK.trim();
    inner = `${LOGO_SVG_DEFS.trim()}\n${bg}\n${shapes}`.trim();
    ids = ["bg", "g", "shadow", "glow"];
  }

  for (const id of ids) {
    inner = replaceAll(inner, `id="${id}"`, `id="${idPrefix}-${id}"`);
    inner = replaceAll(inner, `url(#${id})`, `url(#${idPrefix}-${id})`);
  }

  const label = (ariaLabel ?? "GeoAnalyzr").trim() || "GeoAnalyzr";
  const aria = decorative ? `aria-hidden="true"` : `role="img" aria-label="${escapeAttr(label)}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" focusable="false" ${aria}>${inner}</svg>`;
}
