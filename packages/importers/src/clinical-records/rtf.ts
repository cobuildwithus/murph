// Decode visible RTF text only. Never open objects, links or embedded pictures.
const HIDDEN_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "objdata",
  "filetbl", "listtable", "listoverridetable", "revtbl", "rsidtbl", "generator",
  "datastore", "themedata", "colorschememapping", "fldinst", "xmlnstbl",
]);
const SYMBOLS: Readonly<Record<string, string>> = {
  par: "\n", line: "\n", tab: "\t", cell: "\t", row: "\n",
  emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’",
  ldblquote: "“", rdblquote: "”", "~": "\u00a0", "_": "‑",
};

type RtfState = { hidden: boolean; invisible: boolean; unicodeFallback: number; encoding: string };
type RtfContext = { state: RtfState; skip: number; output: string };

function boundedInteger(value: number | undefined, min: number, max: number): number {
  if (value === undefined || !Number.isInteger(value) || value < min || value > max) throw new Error("Unsupported RTF control.");
  return value;
}

function append(context: RtfContext, value: string): void {
  const skip = Math.min(context.skip, value.length);
  context.skip -= skip;
  if (!context.state.hidden && !context.state.invisible) context.output += value.slice(skip);
}

function applyControl(context: RtfContext, word: string, number: number | undefined): number {
  const state = context.state;
  if (word === "bin") return boundedInteger(number, 0, 20 * 1024 * 1024);
  if (word === "*" || HIDDEN_DESTINATIONS.has(word)) state.hidden = true;
  else if (word === "v") state.invisible = number !== 0;
  else if (word === "plain") state.invisible = false;
  else if (word === "uc") state.unicodeFallback = boundedInteger(number, 0, 16);
  else if (word === "u") {
    const value = boundedInteger(number, -32768, 65535);
    context.skip = 0;
    append(context, String.fromCharCode(value & 0xffff));
    context.skip = state.unicodeFallback;
  } else if (word === "ansicpg") {
    // Multi-byte code pages need a different decoder; do not corrupt them.
    state.encoding = `windows-${boundedInteger(number, 1250, 1258)}`;
  } else if (["mac", "pc", "pca", "upr", "deleted", "revised", "strike", "striked"].includes(word)) throw new Error("Unsupported RTF encoding.");
  else if (["\\", "{", "}"].includes(word)) append(context, word);
  else if (SYMBOLS[word]) append(context, SYMBOLS[word]);
  return 0;
}

function decodeVisible(context: RtfContext, bytes: Uint8Array): void {
  if (!context.state.hidden) append(context, new TextDecoder(context.state.encoding, { fatal: true }).decode(bytes));
}

/** Unsupported encodings, truncated groups and binary payloads fail closed. */
export function readClinicalRtfText(bytes: Uint8Array): string | undefined {
  const source = Buffer.from(bytes).toString("latin1");
  if (!/^\s*\{\\rtf1\b/u.test(source)) return undefined;
  try { return decodeRtf(source); }
  catch { return undefined; }
}

function decodeRtf(source: string): string | undefined {
  const context: RtfContext = { state: { hidden: false, invisible: false, unicodeFallback: 1, encoding: "windows-1252" }, skip: 0, output: "" };
  const stack: RtfState[] = [];
  const token = /([{}])|\\(?:([a-z]+)(-?\d+)? ?|'([0-9a-f]{2})|([^a-z]))|([^{}\\]+)/giy;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match[1] === "{") {
      if (stack.length >= 128) return undefined;
      stack.push({ ...context.state });
    } else if (match[1] === "}") {
      const prior = stack.pop();
      if (!prior) return undefined;
      context.state = prior;
      context.skip = 0;
      if (stack.length === 0) return source.slice(token.lastIndex).trim() ? undefined : context.output.trim() || undefined;
    } else if (stack.length === 0) {
      if (match[0].trim()) return undefined;
    } else if (match[4]) decodeVisible(context, Uint8Array.of(Number.parseInt(match[4], 16)));
    else if (match[6]) decodeVisible(context, Buffer.from(match[6].replace(/[\r\n]/gu, ""), "latin1"));
    else {
      token.lastIndex += applyControl(context, match[2] ?? match[5]!, match[3] === undefined ? undefined : Number(match[3]));
      if (token.lastIndex > source.length) return undefined;
    }
  }
  return undefined;
}
