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

type TelegramRichTextNode = {
  kind: "text";
  value: string;
};

type TelegramRichElementNode = {
  kind: "element";
  name: string;
  children: TelegramRichNode[];
};

type TelegramRichNode = TelegramRichTextNode | TelegramRichElementNode;

function isTelegramRichElement(
  node: TelegramRichNode,
): node is TelegramRichElementNode {
  return node.kind === "element";
}

const TELEGRAM_RICH_VOID_TAGS = new Set(["br", "hr"]);
const TELEGRAM_RICH_ALLOWED_TAGS = new Set([
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "del",
  "details",
  "em",
  "footer",
  "h2",
  "h3",
  "hr",
  "i",
  "ins",
  "li",
  "mark",
  "ol",
  "p",
  "s",
  "strike",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "td",
  "tg-spoiler",
  "th",
  "tr",
  "u",
  "ul",
]);

export function renderTelegramRichContentResponseCardTextV1(
  card: TelegramRichContentResponseCardV1,
): string {
  return parseTelegramRichContentHtml(card.html).fallbackText;
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
              : "Telegram rich content is invalid.",
          path: ["html"],
        });
      }
    });

function parseTelegramRichContentHtml(html: string): {
  fallbackText: string;
} {
  const root: TelegramRichElementNode = {
    kind: "element",
    name: "root",
    children: [],
  };
  const stack: TelegramRichElementNode[] = [root];
  let elementCount = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart === -1) {
      appendTelegramRichText(stack, html.slice(cursor));
      cursor = html.length;
      break;
    }
    appendTelegramRichText(stack, html.slice(cursor, tagStart));
    const tagEnd = html.indexOf(">", tagStart + 1);
    if (tagEnd === -1) {
      throw new TypeError("Telegram rich content has an unfinished tag.");
    }
    const source = html.slice(tagStart, tagEnd + 1);
    const match = /^<(\/)?([a-z][a-z0-9-]*)([^<>]*)>$/u.exec(source);
    if (!match) {
      throw new TypeError("Telegram rich content has a malformed tag.");
    }
    const closing = match[1] === "/";
    const name = match[2] ?? "";
    const attributes = match[3] ?? "";
    if (!TELEGRAM_RICH_ALLOWED_TAGS.has(name)) {
      throw new TypeError(`Telegram rich content does not support <${name}>.`);
    }
    if (closing) {
      if (attributes.trim() !== "" || TELEGRAM_RICH_VOID_TAGS.has(name)) {
        throw new TypeError(
          `Telegram rich content has an invalid </${name}> tag.`,
        );
      }
      const current = stack.at(-1);
      if (current?.name !== name) {
        throw new TypeError(
          `Telegram rich content closes <${name}> out of order.`,
        );
      }
      stack.pop();
    } else {
      validateTelegramRichAttributes(name, attributes);
      elementCount += 1;
      if (elementCount > telegramRichContentCardV1Bounds.elementCount) {
        throw new TypeError("Telegram rich content has too many elements.");
      }
      const node: TelegramRichElementNode = {
        kind: "element",
        name,
        children: [],
      };
      const parent = stack.at(-1);
      if (!parent) {
        throw new TypeError("Telegram rich content has no root element.");
      }
      validateTelegramRichParent(name, parent.name);
      parent.children.push(node);
      if (!TELEGRAM_RICH_VOID_TAGS.has(name)) {
        stack.push(node);
        if (stack.length - 1 > telegramRichContentCardV1Bounds.nestingDepth) {
          throw new TypeError("Telegram rich content is nested too deeply.");
        }
      }
    }
    cursor = tagEnd + 1;
  }

  if (stack.length !== 1) {
    throw new TypeError(
      `Telegram rich content does not close <${stack.at(-1)?.name}>.`,
    );
  }
  const topLevelBlocks = root.children.filter(
    (node) => node.kind === "element",
  ).length;
  if (topLevelBlocks > telegramRichContentCardV1Bounds.topLevelBlocks) {
    throw new TypeError("Telegram rich content has too many top-level blocks.");
  }
  validateTelegramRichStructure(root);
  if (!containsTelegramRichStructure(root)) {
    throw new TypeError(
      "Telegram rich content must use a heading, list, table, details, or callout.",
    );
  }
  const fallbackText = normalizeTelegramRichFallback(
    renderTelegramRichNodes(root.children),
  );
  if (fallbackText.length === 0) {
    throw new TypeError("Telegram rich content must include visible text.");
  }
  if (
    Array.from(fallbackText).length >
    telegramRichContentCardV1Bounds.fallbackTextLength
  ) {
    throw new TypeError("Telegram rich content text fallback is too long.");
  }
  return { fallbackText };
}

function appendTelegramRichText(
  stack: TelegramRichElementNode[],
  value: string,
): void {
  if (value === "") {
    return;
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
    throw new TypeError("Telegram rich content contains a control character.");
  }
  validateTelegramRichEntities(value);
  validateTelegramRichVisibleText(value);
  const parent = stack.at(-1);
  if (!parent) {
    throw new TypeError("Telegram rich content has no text parent.");
  }
  parent.children.push({ kind: "text", value });
}

function validateTelegramRichVisibleText(value: string): void {
  const decoded = decodeTelegramRichEntities(value);
  if (/(?:https?)\s*:\s*\/\s*\/|\bwww\s*\./iu.test(decoded)) {
    throw new TypeError("Telegram rich content cannot include visible URLs.");
  }
}

function validateTelegramRichAttributes(name: string, source: string): void {
  const attributes = source.trim();
  if (attributes === "") {
    return;
  }
  if (name === "table") {
    const values = attributes.split(/\s+/u);
    if (
      values.some((value) => value !== "bordered" && value !== "striped") ||
      new Set(values).size !== values.length
    ) {
      throw new TypeError(
        "Telegram rich tables only allow bordered and striped.",
      );
    }
    return;
  }
  if (name === "details" && attributes === "open") {
    return;
  }
  if (
    (name === "td" || name === "th") &&
    /^align="(?:left|center|right)"$/u.test(attributes)
  ) {
    return;
  }
  throw new TypeError(
    `Telegram rich content has unsupported attributes on <${name}>.`,
  );
}

function validateTelegramRichParent(name: string, parent: string): void {
  if (name === "li" && parent !== "ul" && parent !== "ol") {
    throw new TypeError("Telegram rich list items must be inside a list.");
  }
  if (name === "summary" && parent !== "details") {
    throw new TypeError("Telegram rich summaries must be inside details.");
  }
  if ((name === "caption" || name === "tr") && parent !== "table") {
    throw new TypeError(`Telegram rich <${name}> must be inside a table.`);
  }
  if ((name === "th" || name === "td") && parent !== "tr") {
    throw new TypeError(`Telegram rich <${name}> must be inside a table row.`);
  }
}

function validateTelegramRichStructure(node: TelegramRichElementNode): void {
  if (node.name === "ul" || node.name === "ol") {
    validateTelegramRichChildren(node, new Set(["li"]));
  }
  if (node.name === "tr") {
    validateTelegramRichChildren(node, new Set(["th", "td"]));
  }
  if (node.name === "details") {
    const summaries = node.children.filter(
      (child) => child.kind === "element" && child.name === "summary",
    );
    if (summaries.length !== 1) {
      throw new TypeError("Telegram rich details need exactly one summary.");
    }
    const firstElement = node.children.find(isTelegramRichElement);
    if (firstElement?.name !== "summary") {
      throw new TypeError(
        "Telegram rich details must start with their summary.",
      );
    }
  }
  if (node.name === "table") {
    validateTelegramRichChildren(node, new Set(["caption", "tr"]));
    const captions = node.children
      .filter(isTelegramRichElement)
      .filter((child) => child.name === "caption");
    if (captions.length > 1) {
      throw new TypeError("Telegram rich tables allow at most one caption.");
    }
    const firstElement = node.children.find(isTelegramRichElement);
    if (captions.length === 1 && firstElement?.name !== "caption") {
      throw new TypeError(
        "Telegram rich table captions must come before table rows.",
      );
    }
    const rows = node.children
      .filter(isTelegramRichElement)
      .filter((child) => child.name === "tr");
    if (
      rows.length === 0 ||
      rows.length > telegramRichContentCardV1Bounds.tableRows
    ) {
      throw new TypeError("Telegram rich tables need between 1 and 12 rows.");
    }
    for (const row of rows) {
      const cells = row.children
        .filter(isTelegramRichElement)
        .filter((child) => child.name === "th" || child.name === "td");
      if (
        cells.length === 0 ||
        cells.length > telegramRichContentCardV1Bounds.tableColumns
      ) {
        throw new TypeError(
          "Telegram rich table rows need between 1 and 5 cells.",
        );
      }
    }
  }
  for (const child of node.children) {
    if (child.kind === "element") {
      validateTelegramRichStructure(child);
    }
  }
}

function validateTelegramRichChildren(
  node: TelegramRichElementNode,
  allowedNames: ReadonlySet<string>,
): void {
  for (const child of node.children) {
    if (child.kind === "text") {
      if (decodeTelegramRichEntities(child.value).trim() !== "") {
        throw new TypeError(`Telegram rich <${node.name}> has stray text.`);
      }
      continue;
    }
    if (!allowedNames.has(child.name)) {
      throw new TypeError(
        `Telegram rich <${child.name}> cannot be inside <${node.name}>.`,
      );
    }
  }
}

function containsTelegramRichStructure(node: TelegramRichElementNode): boolean {
  const structuralNames = new Set([
    "aside",
    "blockquote",
    "details",
    "h2",
    "h3",
    "ol",
    "table",
    "ul",
  ]);
  return node.children.some(
    (child) =>
      child.kind === "element" &&
      (structuralNames.has(child.name) || containsTelegramRichStructure(child)),
  );
}

function validateTelegramRichEntities(value: string): void {
  const invalid = value.replace(
    /&(?:amp|apos|gt|lt|nbsp|quot|#\d+|#x[0-9a-fA-F]+);/gu,
    "",
  );
  if (invalid.includes("&")) {
    throw new TypeError(
      "Telegram rich content has an unsupported HTML entity.",
    );
  }
  for (const match of value.matchAll(/&#(x[0-9a-fA-F]+|\d+);/gu)) {
    const source = match[1] ?? "";
    const codePoint = source.startsWith("x")
      ? Number.parseInt(source.slice(1), 16)
      : Number.parseInt(source, 10);
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
      throw new TypeError(
        "Telegram rich content has an invalid numeric entity.",
      );
    }
  }
}

function renderTelegramRichNodes(nodes: TelegramRichNode[]): string {
  return nodes.map(renderTelegramRichNode).join("");
}

function renderTelegramRichNode(node: TelegramRichNode): string {
  if (node.kind === "text") {
    return decodeTelegramRichEntities(node.value);
  }
  const content = renderTelegramRichNodes(node.children);
  switch (node.name) {
    case "h2":
    case "h3":
    case "p":
    case "footer":
    case "caption":
    case "summary":
      return `${content}\n`;
    case "blockquote":
    case "aside":
    case "cite":
      return `${content
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n---\n";
    case "ul":
      return `${renderTelegramRichList(node, false)}\n`;
    case "ol":
      return `${renderTelegramRichList(node, true)}\n`;
    case "li":
      return content;
    case "table":
      return `${renderTelegramRichTable(node)}\n`;
    case "tr":
    case "th":
    case "td":
      return content;
    case "details":
      return `${content}\n`;
    default:
      return content;
  }
}

function renderTelegramRichList(
  node: TelegramRichElementNode,
  ordered: boolean,
): string {
  const items = node.children
    .filter(isTelegramRichElement)
    .filter((child) => child.name === "li");
  return items
    .map((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : "• ";
      const text = renderTelegramRichNodes(item.children).trim();
      return `${prefix}${text.replace(/\n/gu, "\n   ")}`;
    })
    .join("\n");
}

function renderTelegramRichTable(node: TelegramRichElementNode): string {
  const caption = node.children.find(
    (child) => child.kind === "element" && child.name === "caption",
  );
  const rows = node.children
    .filter(isTelegramRichElement)
    .filter((child) => child.name === "tr");
  const renderedRows = rows.map((row) =>
    row.children
      .filter(isTelegramRichElement)
      .filter((child) => child.name === "th" || child.name === "td")
      .map((cell) =>
        renderTelegramRichNodes(cell.children).trim().replace(/\s+/gu, " "),
      )
      .join(" | "),
  );
  const renderedCaption =
    caption?.kind === "element"
      ? renderTelegramRichNodes(caption.children).trim()
      : "";
  return [renderedCaption, ...renderedRows]
    .filter((line) => line !== "")
    .join("\n");
}

function normalizeTelegramRichFallback(value: string): string {
  return value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function decodeTelegramRichEntities(value: string): string {
  return value.replace(
    /&(amp|apos|gt|lt|nbsp|quot|#\d+|#x[0-9a-fA-F]+);/gu,
    (entity, name: string) => {
      switch (name) {
        case "amp":
          return "&";
        case "apos":
          return "'";
        case "gt":
          return ">";
        case "lt":
          return "<";
        case "nbsp":
          return " ";
        case "quot":
          return '"';
        default: {
          const codePoint = name.startsWith("#x")
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
          return Number.isSafeInteger(codePoint) &&
            codePoint >= 0 &&
            codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : "�";
        }
      }
    },
  );
}
