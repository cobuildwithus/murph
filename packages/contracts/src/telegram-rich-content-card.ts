import * as z from "./zod-runtime.ts";

export const telegramRichContentCardV1Bounds = {
  elementCount: 100,
  fallbackTextLength: 4_096,
  htmlLength: 8_192,
  nestingDepth: 6,
  tableColumns: 5,
  tableRows: 12,
  topLevelBlocks: 32,
} as const;

export type TelegramRichContentResponseCardV1 = {
  kind: "telegram_rich_content";
  version: 1;
  html: string;
};

type Frame = {
  name: string;
  text: string;
  childElements: number;
  index: number;
  summaries: number;
  rows: number;
  cells: number;
};

const ALLOWED_TAGS = new Set(
  "aside b blockquote br caption cite code details em footer h2 h3 hr i ins li mark ol p strong summary table td th tr u ul".split(
    " ",
  ),
);
const VOID_TAGS = new Set(["br", "hr"]);
const STRUCTURAL_TAGS = new Set([
  "aside",
  "blockquote",
  "details",
  "h2",
  "h3",
  "ol",
  "table",
  "ul",
]);

export function renderTelegramRichContentResponseCardTextV1(
  card: TelegramRichContentResponseCardV1,
): string {
  return parseTelegramRichContentHtml(card.html);
}

export const telegramRichContentResponseCardV1Schema: z.ZodType<TelegramRichContentResponseCardV1> =
  z
    .object({
      kind: z.literal("telegram_rich_content"),
      version: z.literal(1),
      html: z
        .string()
        .trim()
        .min(1)
        .max(telegramRichContentCardV1Bounds.htmlLength),
    })
    .strict()
    .superRefine((card, context) => {
      try {
        parseTelegramRichContentHtml(card.html);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message:
            error instanceof Error
              ? error.message
              : "Invalid Telegram rich content.",
          path: ["html"],
        });
      }
    });

function parseTelegramRichContentHtml(html: string): string {
  const stack: Frame[] = [createFrame("root", 0)];
  let cursor = 0;
  let elementCount = 0;
  let hasStructure = false;

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start === -1) {
      appendText(stack.at(-1), html.slice(cursor));
      break;
    }
    appendText(stack.at(-1), html.slice(cursor, start));
    const end = html.indexOf(">", start + 1);
    if (end === -1) invalid();
    const match = /^<(\/)?([a-z][a-z0-9-]*)([^<>]*)>$/u.exec(
      html.slice(start, end + 1),
    );
    if (!match) invalid();
    const closing = match[1] === "/";
    const name = match[2] ?? "";
    const attributes = match[3] ?? "";
    if (!ALLOWED_TAGS.has(name)) invalid();

    if (closing) {
      if (attributes.trim() !== "" || VOID_TAGS.has(name)) invalid();
      closeFrame(stack, name);
    } else {
      validateAttributes(name, attributes);
      elementCount += 1;
      if (elementCount > telegramRichContentCardV1Bounds.elementCount) {
        invalid();
      }
      const parent = stack.at(-1);
      if (!parent) invalid();
      validateChild(parent, name);
      parent.childElements += 1;
      if (
        parent.name === "root" &&
        parent.childElements > telegramRichContentCardV1Bounds.topLevelBlocks
      ) {
        invalid();
      }
      const frame = createFrame(name, parent.childElements);
      hasStructure ||= STRUCTURAL_TAGS.has(name);
      if (VOID_TAGS.has(name)) {
        appendFrame(parent, frame);
      } else {
        stack.push(frame);
        if (stack.length - 1 > telegramRichContentCardV1Bounds.nestingDepth) {
          invalid();
        }
      }
    }
    cursor = end + 1;
  }

  if (stack.length !== 1 || !hasStructure) invalid();
  const fallback = normalizeFallback(stack[0]?.text ?? "");
  if (
    fallback.length === 0 ||
    Array.from(fallback).length >
      telegramRichContentCardV1Bounds.fallbackTextLength
  ) {
    invalid();
  }
  return fallback;
}

function createFrame(name: string, index: number): Frame {
  return {
    name,
    text: "",
    childElements: 0,
    index,
    summaries: 0,
    rows: 0,
    cells: 0,
  };
}

function closeFrame(stack: Frame[], name: string): void {
  const frame = stack.at(-1);
  if (!frame || frame.name !== name) invalid();
  if (name === "details" && frame.summaries !== 1) invalid();
  if (
    name === "table" &&
    (frame.rows === 0 || frame.rows > telegramRichContentCardV1Bounds.tableRows)
  ) {
    invalid();
  }
  if (
    name === "tr" &&
    (frame.cells === 0 ||
      frame.cells > telegramRichContentCardV1Bounds.tableColumns)
  ) {
    invalid();
  }
  stack.pop();
  const parent = stack.at(-1);
  if (!parent) invalid();
  appendFrame(parent, frame);
}

function validateChild(parent: Frame, name: string): void {
  if (
    ((parent.name === "ul" || parent.name === "ol") && name !== "li") ||
    (parent.name === "tr" && name !== "th" && name !== "td") ||
    (parent.name === "table" && name !== "caption" && name !== "tr")
  ) {
    invalid();
  }
  if (
    (name === "li" && parent.name !== "ul" && parent.name !== "ol") ||
    (name === "summary" && parent.name !== "details") ||
    ((name === "caption" || name === "tr") && parent.name !== "table") ||
    ((name === "th" || name === "td") && parent.name !== "tr")
  ) {
    invalid();
  }
  if (parent.name === "details") {
    if (parent.childElements === 0 && name !== "summary") invalid();
    if (name === "summary") {
      parent.summaries += 1;
      if (parent.summaries > 1 || parent.childElements !== 0) invalid();
    }
  }
  if (parent.name === "table") {
    if (name === "caption" && parent.childElements !== 0) invalid();
    if (name === "tr") parent.rows += 1;
  }
  if (parent.name === "tr") parent.cells += 1;
}

function validateAttributes(name: string, source: string): void {
  const attributes = source.trim();
  if (attributes === "") return;
  if (name === "table") {
    const values = attributes.split(/\s+/u);
    if (
      values.every((value) => value === "bordered" || value === "striped") &&
      new Set(values).size === values.length
    ) {
      return;
    }
  }
  if (name === "details" && attributes === "open") return;
  if (
    (name === "td" || name === "th") &&
    /^align="(?:left|center|right)"$/u.test(attributes)
  ) {
    return;
  }
  invalid();
}

function appendText(frame: Frame | undefined, source: string): void {
  if (!frame || source === "") return;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(source)) invalid();
  const text = decodeEntities(source);
  if (
    frame.name === "ul" ||
    frame.name === "ol" ||
    frame.name === "table" ||
    frame.name === "tr"
  ) {
    if (text.trim() !== "") invalid();
    return;
  }
  frame.text += text;
}

function appendFrame(parent: Frame, child: Frame): void {
  if (parent.name === "ul" || parent.name === "ol") {
    const prefix = parent.name === "ol" ? `${child.index}. ` : "• ";
    const text = child.text.trim().replace(/\n/gu, "\n   ");
    parent.text += `${parent.text === "" ? "" : "\n"}${prefix}${text}`;
    return;
  }
  if (parent.name === "tr") {
    const text = child.text.trim().replace(/\s+/gu, " ");
    parent.text += `${parent.text === "" ? "" : " | "}${text}`;
    return;
  }
  if (parent.name === "table") {
    const text = child.text.trim();
    parent.text += `${parent.text === "" ? "" : "\n"}${text}`;
    return;
  }
  parent.text += renderFrame(child);
}

function renderFrame(frame: Frame): string {
  switch (frame.name) {
    case "h2":
    case "h3":
    case "p":
    case "footer":
    case "summary":
    case "ul":
    case "ol":
    case "table":
    case "details":
      return `${frame.text}\n`;
    case "blockquote":
    case "aside":
    case "cite":
      return `${frame.text
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n---\n";
    default:
      return frame.text;
  }
}

function decodeEntities(value: string): string {
  const entity = /&(amp|apos|gt|lt|nbsp|quot|#\d+|#x[0-9a-fA-F]+);/gu;
  if (value.replace(entity, "").includes("&")) invalid();
  return value.replace(entity, (_match, name: string) => {
    const named = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"',
    }[name];
    if (named !== undefined) return named;
    const codePoint = name.startsWith("#x")
      ? Number.parseInt(name.slice(2), 16)
      : Number.parseInt(name.slice(1), 10);
    if (
      !Number.isSafeInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint < 0x20 &&
        codePoint !== 0x09 &&
        codePoint !== 0x0a &&
        codePoint !== 0x0d)
    ) {
      invalid();
    }
    return String.fromCodePoint(codePoint);
  });
}

function normalizeFallback(value: string): string {
  return value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function invalid(): never {
  throw new TypeError("Invalid Telegram rich content.");
}
