import { createHash } from "node:crypto";

export interface ParsedEmailAttachment {
  contentDisposition: string | null;
  contentId: string | null;
  contentTransferEncoding: string | null;
  contentType: string | null;
  data: Uint8Array | null;
  fileName: string | null;
}

export interface ParsedEmailMessage {
  attachments: ParsedEmailAttachment[];
  bcc: string[];
  cc: string[];
  from: string | null;
  headers: Record<string, string>;
  html: string | null;
  inReplyTo: string | null;
  messageId: string | null;
  occurredAt: string | null;
  rawHash: string;
  rawSize: number;
  receivedAt: string | null;
  references: string[];
  replyTo: string[];
  subject: string | null;
  text: string | null;
  to: string[];
}

export interface RawEmailHeaderValue {
  repeated: boolean;
  value: string | null;
}

interface ParsedMimeEntity {
  bodyText: string;
  contentDisposition: string | null;
  contentDispositionParams: Record<string, string>;
  contentTransferEncoding: string | null;
  contentType: string | null;
  contentTypeParams: Record<string, string>;
  headers: Record<string, string>;
  parts: ParsedMimeEntity[];
}

const utf8Decoder = new TextDecoder();
const utf8Encoder = new TextEncoder();

export function parseRawEmailMessage(
  input: Uint8Array | ArrayBuffer | string,
): ParsedEmailMessage {
  const rawBytes = toRawEmailBytes(input);
  const rawText = utf8Decoder.decode(rawBytes);
  const entity = parseMimeEntity(rawText);
  const collected = collectMimeLeafContent(entity);

  return {
    attachments: collected.attachments,
    bcc: splitEmailAddressList(entity.headers["bcc"] ?? null),
    cc: splitEmailAddressList(entity.headers["cc"] ?? null),
    from: normalizeHeaderText(entity.headers["from"] ?? null),
    headers: { ...entity.headers },
    html: collected.html,
    inReplyTo: parseMessageIds(entity.headers["in-reply-to"] ?? null)[0] ?? null,
    messageId: parseMessageIds(entity.headers["message-id"] ?? null)[0] ?? null,
    occurredAt: parseHeaderDate(entity.headers.date ?? null),
    rawHash: createHash("sha256").update(rawBytes).digest("hex"),
    rawSize: rawBytes.byteLength,
    receivedAt: parseHeaderDate(entity.headers.date ?? null),
    references: parseMessageIds(entity.headers.references ?? null),
    replyTo: splitEmailAddressList(entity.headers["reply-to"] ?? null),
    subject: decodeHeaderWords(entity.headers.subject ?? null),
    text: collected.text,
    to: splitEmailAddressList(entity.headers.to ?? null),
  };
}

export function splitEmailAddressList(value: string | null | undefined): string[] {
  const normalized = normalizeHeaderText(value);
  if (!normalized) {
    return [];
  }

  const segments: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let angleDepth = 0;

  for (const char of normalized) {
    if (char === '"') {
      inQuotes = !inQuotes;
      buffer += char;
      continue;
    }

    if (!inQuotes) {
      if (char === "<") {
        angleDepth += 1;
      } else if (char === ">" && angleDepth > 0) {
        angleDepth -= 1;
      } else if (char === "," && angleDepth === 0) {
        const segment = buffer.trim();
        if (segment.length > 0) {
          segments.push(segment);
        }
        buffer = "";
        continue;
      }
    }

    buffer += char;
  }

  const tail = buffer.trim();
  if (tail.length > 0) {
    segments.push(tail);
  }

  return segments
    .map((segment) => decodeHeaderWords(segment))
    .filter((segment): segment is string => segment !== null);
}

export function readRawEmailHeaderValue(
  input: Uint8Array | ArrayBuffer | string,
  headerName: string,
): RawEmailHeaderValue {
  const rawBytes = toRawEmailBytes(input);
  const rawText = utf8Decoder.decode(rawBytes);
  const matchingValues = parseRawEmailHeaderEntries(readRawEmailHeaderBlock(rawText))
    .filter((entry) => entry.name === headerName.trim().toLowerCase())
    .map((entry) => entry.value);

  return {
    repeated: matchingValues.length > 1,
    value:
      matchingValues.length === 1
        ? decodeHeaderWords(matchingValues[0] ?? null)
        : null,
  };
}

function parseMimeEntity(rawEntity: string): ParsedMimeEntity {
  const { bodyText, headers } = splitRawEmailEntity(rawEntity);
  const { params: contentDispositionParams, value: contentDisposition } = parseHeaderParams(
    headers["content-disposition"] ?? null,
  );
  const { params: contentTypeParams, value: contentType } = parseHeaderParams(
    headers["content-type"] ?? null,
  );
  const boundary = contentTypeParams.boundary ?? null;
  const normalizedContentType = contentType?.toLowerCase() ?? null;

  return {
    bodyText,
    contentDisposition,
    contentDispositionParams,
    contentTransferEncoding: normalizeHeaderText(headers["content-transfer-encoding"] ?? null)?.toLowerCase() ?? null,
    contentType: normalizedContentType,
    contentTypeParams,
    headers,
    parts:
      normalizedContentType?.startsWith("multipart/") && boundary
        ? splitMultipartBody(bodyText, boundary).map((part) => parseMimeEntity(part))
        : [],
  };
}

function splitRawEmailEntity(rawEntity: string): {
  bodyText: string;
  headers: Record<string, string>;
} {
  const headerMatch = /\r?\n\r?\n/u.exec(rawEntity);
  const headerText = readRawEmailHeaderBlock(rawEntity);
  if (!headerMatch || headerMatch.index === undefined) {
    return {
      bodyText: "",
      headers: parseRawEmailHeaders(headerText),
    };
  }

  const bodyText = rawEntity.slice(headerMatch.index + headerMatch[0].length);
  return {
    bodyText,
    headers: parseRawEmailHeaders(headerText),
  };
}

function parseRawEmailHeaders(headerText: string): Record<string, string> {
  return Object.fromEntries(
    parseRawEmailHeaderEntries(headerText).map((entry) => [entry.name, entry.value] as const),
  );
}

function parseRawEmailHeaderEntries(headerText: string): Array<{ name: string; value: string }> {
  const lines = headerText.split(/\r?\n/u);
  const entries: Array<{ name: string; value: string }> = [];
  let currentName: string | null = null;
  let currentValue = "";

  for (const line of lines) {
    if (/^[ \t]/u.test(line) && currentName) {
      currentValue = `${currentValue} ${line.trim()}`.trim();
      continue;
    }

    if (currentName) {
      entries.push({
        name: currentName,
        value: currentValue,
      });
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      currentName = null;
      currentValue = "";
      continue;
    }

    currentName = line.slice(0, separatorIndex).trim().toLowerCase();
    currentValue = line.slice(separatorIndex + 1).trim();
  }

  if (currentName) {
    entries.push({
      name: currentName,
      value: currentValue,
    });
  }

  return entries;
}

function readRawEmailHeaderBlock(rawEntity: string): string {
  const headerMatch = /\r?\n\r?\n/u.exec(rawEntity);
  if (!headerMatch || headerMatch.index === undefined) {
    return rawEntity;
  }

  return rawEntity.slice(0, headerMatch.index);
}

function splitMultipartBody(bodyText: string, boundary: string): string[] {
  const parts: string[] = [];
  const normalizedBoundary = `--${boundary}`;
  const closingBoundary = `--${boundary}--`;
  const lines = bodyText.replace(/\r\n/gu, "\n").split("\n");
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === normalizedBoundary) {
      if (current !== null) {
        parts.push(current.join("\n"));
      }
      current = [];
      continue;
    }

    if (line === closingBoundary) {
      if (current !== null) {
        parts.push(current.join("\n"));
      }
      break;
    }

    if (current !== null) {
      current.push(line);
    }
  }

  return parts.filter((part) => part.trim().length > 0);
}

function collectMimeLeafContent(entity: ParsedMimeEntity): {
  attachments: ParsedEmailAttachment[];
  html: string | null;
  text: string | null;
} {
  if (entity.parts.length > 0) {
    let text: string | null = null;
    let html: string | null = null;
    const attachments: ParsedEmailAttachment[] = [];

    for (const part of entity.parts) {
      const nested = collectMimeLeafContent(part);
      text ??= nested.text;
      html ??= nested.html;
      attachments.push(...nested.attachments);
    }

    return {
      attachments,
      html,
      text,
    };
  }

  const fileName = decodeHeaderWords(
    entity.contentDispositionParams.filename
      ?? entity.contentTypeParams.name
      ?? null,
  );
  const contentBytes = decodeMimeBodyBytes(entity.bodyText, entity.contentTransferEncoding);
  const contentType = entity.contentType ?? "text/plain";
  const isAttachment = isMimeAttachment(entity, fileName);

  if (isAttachment) {
    return {
      attachments: [
        {
          contentDisposition: entity.contentDisposition,
          contentId: normalizeHeaderText(entity.headers["content-id"] ?? null),
          contentTransferEncoding: entity.contentTransferEncoding,
          contentType,
          data: contentBytes,
          fileName,
        },
      ],
      html: null,
      text: null,
    };
  }

  if (contentType.startsWith("text/html")) {
    return {
      attachments: [],
      html: decodeMimeText(contentBytes, entity.contentTypeParams.charset ?? null),
      text: null,
    };
  }

  if (contentType.startsWith("text/plain") || entity.contentType === null) {
    return {
      attachments: [],
      html: null,
      text: decodeMimeText(contentBytes, entity.contentTypeParams.charset ?? null),
    };
  }

  return {
    attachments: [],
    html: null,
    text: null,
  };
}

function isMimeAttachment(entity: ParsedMimeEntity, fileName: string | null): boolean {
  const disposition = entity.contentDisposition ?? "";
  return disposition.startsWith("attachment")
    || (disposition.startsWith("inline") && fileName !== null)
    || fileName !== null;
}

function decodeMimeBodyBytes(bodyText: string, transferEncoding: string | null): Uint8Array {
  switch (transferEncoding) {
    case "base64":
      return decodeBase64Bytes(bodyText.replace(/\s+/gu, ""));
    case "quoted-printable":
      return decodeQuotedPrintableBytes(bodyText);
    default:
      return utf8Encoder.encode(bodyText);
  }
}

function decodeMimeText(bytes: Uint8Array, charset: string | null): string {
  if (bytes.byteLength === 0) {
    return "";
  }

  const normalizedCharset = charset?.trim().toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(normalizedCharset).decode(bytes).trim();
  } catch {
    return utf8Decoder.decode(bytes).trim();
  }
}

function parseHeaderParams(value: string | null): {
  params: Record<string, string>;
  value: string | null;
} {
  const normalized = normalizeHeaderText(value);
  if (!normalized) {
    return {
      params: {},
      value: null,
    };
  }

  const [head, ...tail] = normalized.split(";");
  const params: Record<string, string> = {};

  for (const part of tail) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const rawValue = part.slice(separatorIndex + 1).trim().replace(/^"|"$/gu, "");
    if (key.length === 0 || rawValue.length === 0) {
      continue;
    }

    const decoded = decodeHeaderWords(rawValue);
    if (!decoded) {
      continue;
    }

    params[key] = decoded;
  }

  return {
    params,
    value: head.trim().toLowerCase(),
  };
}

function parseMessageIds(value: string | null): string[] {
  const normalized = normalizeHeaderText(value);
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/<[^>]+>/gu);
  if (!matches) {
    return normalized.trim() ? [normalized.trim()] : [];
  }

  return [...new Set(matches.map((entry) => entry.trim()))];
}

function parseHeaderDate(value: string | null): string | null {
  const normalized = normalizeHeaderText(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : null;
}

function normalizeHeaderText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function decodeHeaderWords(value: string | null | undefined): string | null {
  const normalized = normalizeHeaderText(value);
  if (!normalized) {
    return null;
  }

  const decoded = normalized.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/gu,
    (_match, charset: string, encoding: string, payload: string) => {
      const bytes = encoding.toLowerCase() === "b"
        ? decodeBase64Bytes(payload)
        : decodeQuotedPrintableBytes(payload.replace(/_/gu, " "));
      try {
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return utf8Decoder.decode(bytes);
      }
    },
  );

  return decoded.trim();
}

function decodeQuotedPrintableBytes(value: string): Uint8Array {
  const cleaned = value.replace(/=(?:\r\n|\n|\r)/gu, "");
  const bytes: number[] = [];

  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index]!;
    if (char === "=" && /^[0-9A-Fa-f]{2}$/u.test(cleaned.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(cleaned.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    bytes.push(char.charCodeAt(0));
  }

  return Uint8Array.from(bytes);
}

function decodeBase64Bytes(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toRawEmailBytes(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === "string") {
    return utf8Encoder.encode(input);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  return new Uint8Array(input);
}
