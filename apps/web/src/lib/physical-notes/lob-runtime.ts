import "server-only";

import { Buffer } from "node:buffer";

import {
  AddressEditable,
  Configuration,
  CountryExtended,
  LetterEditable,
  LetterEditableAddressPlacementEnum,
  LettersApi,
  LtrUseType,
  MailType,
} from "@lob/lob-typescript-sdk";
import type {
  HostedPhysicalNoteRecipient,
} from "@murphai/hosted-execution/physical-notes";

const LOB_API_BASE_URL = "https://api.lob.com";
const LOB_API_VERSION = "2024-01-01";
const LOB_LOOKUP_TIMEOUT_MS = 5_000;
const LOB_REQUEST_TIMEOUT_MS = 30_000;
const PHYSICAL_NOTE_METADATA_KEY = "murph_physical_note_id";

type LobSdkRequestOptions = NonNullable<
  Parameters<LettersApi["create"]>[2]
>;
type LobAxiosAdapter = Extract<
  NonNullable<LobSdkRequestOptions["adapter"]>,
  (...args: never[]) => unknown
>;
type LobAxiosRequestConfig = Parameters<LobAxiosAdapter>[0];
type LobAxiosResponse = Awaited<ReturnType<LobAxiosAdapter>>;

export type LobPhysicalNoteCreateResult =
  | {
      kind: "accepted";
      providerLetterId: string;
    }
  | {
      kind: "definite_failure";
      status: number;
    }
  | {
      kind: "ambiguous_failure";
    };

export type LobPhysicalNoteLookupResult =
  | {
      kind: "accepted";
      providerLetterId: string;
    }
  | {
      kind: "absent";
    }
  | {
      kind: "indeterminate";
    };

export interface LobPhysicalNoteRuntime {
  create(input: {
    artworkUrl: string;
    idempotencyKey: string;
    noteId: string;
    recipient: HostedPhysicalNoteRecipient;
    signal?: AbortSignal;
  }): Promise<LobPhysicalNoteCreateResult>;
  findLetterByNoteId(input: {
    noteId: string;
    signal?: AbortSignal;
  }): Promise<LobPhysicalNoteLookupResult>;
}

export function createLobPhysicalNoteRuntime(input: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  fromAddressId: string;
}): LobPhysicalNoteRuntime {
  const apiKey = requireValue(input.apiKey, "Lob API key");
  const fromAddressId = requireValue(input.fromAddressId, "Lob from address id");
  const fetchImpl = input.fetchImpl ?? fetch;

  return {
    async create(request) {
      request.signal?.throwIfAborted();
      const signal = request.signal
        ? AbortSignal.any([
            request.signal,
            AbortSignal.timeout(LOB_REQUEST_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(LOB_REQUEST_TIMEOUT_MS);
      const letters = createLobLettersApi({
        apiKey,
        fetchImpl,
        signal,
      });

      try {
        const letter: LetterEditable = createLobLetter({
          artworkUrl: request.artworkUrl,
          fromAddressId,
          noteId: request.noteId,
          recipient: request.recipient,
        });
        const response = await letters.create(letter, request.idempotencyKey);
        const providerLetterId = readLobLetterId(response);
        return providerLetterId
          ? { kind: "accepted", providerLetterId }
          : { kind: "ambiguous_failure" };
      } catch (error) {
        const status = readLobHttpStatus(error);
        return status !== null && status < 500
          ? { kind: "definite_failure", status }
          : { kind: "ambiguous_failure" };
      }
    },
    async findLetterByNoteId(request) {
      request.signal?.throwIfAborted();
      const signal = request.signal
        ? AbortSignal.any([
            request.signal,
            AbortSignal.timeout(LOB_LOOKUP_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(LOB_LOOKUP_TIMEOUT_MS);
      const letters = createLobLettersApi({
        apiKey,
        fetchImpl,
        signal,
      });
      const query: Record<string, string> = {};
      query[`metadata[${PHYSICAL_NOTE_METADATA_KEY}]`] = request.noteId;
      const requestOptions: LobSdkRequestOptions = {};
      requestOptions.params = query;

      try {
        const response = await letters.list(
          2,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          requestOptions,
        );
        return readLobLetterLookup(response) ?? { kind: "indeterminate" };
      } catch {
        return { kind: "indeterminate" };
      }
    },
  };
}

export function renderPhysicalNoteHtml(artworkUrl: string): string {
  const url = new URL(artworkUrl);
  if (url.protocol !== "https:") {
    throw new TypeError("Physical-note artwork URL must use HTTPS.");
  }
  const escapedUrl = escapeHtmlAttribute(url.toString());
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    "<style>",
    "@page{size:8.5in 11in;margin:0}",
    "html,body{box-sizing:border-box;width:8.5in;height:11in;margin:0;overflow:hidden;background:#fff}",
    "body{padding:.0625in}",
    "img{display:block;width:100%;height:100%;object-fit:cover;object-position:center}",
    "</style></head>",
    `<body><img src="${escapedUrl}" alt=""></body></html>`,
  ].join("");
}

class UsLetterEditable extends LetterEditable {
  readonly size = "us_letter";
}

class LobHttpStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("Lob request failed.");
    this.name = "LobHttpStatusError";
    this.status = status;
  }
}

function createLobLetter(input: {
  artworkUrl: string;
  fromAddressId: string;
  noteId: string;
  recipient: HostedPhysicalNoteRecipient;
}): LetterEditable {
  const recipient = new AddressEditable();
  recipient.address_city = input.recipient.city;
  recipient.address_country = CountryExtended.Us;
  recipient.address_line1 = input.recipient.addressLine1;
  if (input.recipient.addressLine2) {
    recipient.address_line2 = input.recipient.addressLine2;
  }
  recipient.address_state = input.recipient.state;
  recipient.address_zip = input.recipient.postalCode;
  recipient.name = input.recipient.name;

  const metadata: Record<string, string> = {};
  metadata[PHYSICAL_NOTE_METADATA_KEY] = input.noteId;

  const letter: LetterEditable = new UsLetterEditable();
  letter.address_placement = LetterEditableAddressPlacementEnum.InsertBlankPage;
  letter.color = true;
  letter.double_sided = true;
  letter.file = renderPhysicalNoteHtml(input.artworkUrl);
  letter.from = input.fromAddressId;
  letter.mail_type = MailType.FirstClass;
  letter.metadata = metadata;
  letter.to = recipient;
  letter.use_type = LtrUseType.Operational;
  return letter;
}

function createLobLettersApi(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}): LettersApi {
  const baseOptions: LobSdkRequestOptions = {};
  baseOptions.adapter = createLobFetchAdapter(input.fetchImpl, input.signal);
  baseOptions.headers = {
    "Lob-Version": LOB_API_VERSION,
  };

  return new LettersApi(new Configuration({
    baseOptions,
    basePath: `${LOB_API_BASE_URL}/v1`,
    password: "",
    username: input.apiKey,
  }));
}

function createLobFetchAdapter(
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): LobAxiosAdapter {
  return async (config): Promise<LobAxiosResponse> => {
    const url = readLobRequestUrl(config);
    const headers = readLobRequestHeaders(config);
    const method = requireValue(config.method ?? "GET", "Lob request method")
      .toUpperCase();
    const body = readLobRequestBody(config.data);
    const requestInit: RequestInit = {
      headers,
      method,
      redirect: "error",
      signal,
    };
    if (body !== undefined) {
      requestInit.body = body;
    }
    const response = await fetchImpl(url, requestInit);

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new LobHttpStatusError(response.status);
    }

    const data: unknown = await response.json();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    return {
      config,
      data,
      headers: responseHeaders,
      status: response.status,
      statusText: response.statusText,
    };
  };
}

function readLobRequestUrl(config: LobAxiosRequestConfig): URL {
  const url = new URL(requireValue(config.url ?? "", "Lob request URL"));
  appendLobRequestParams(url, config.params);
  return url;
}

function appendLobRequestParams(url: URL, value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Lob request params must be an object.");
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new TypeError("Lob request params must be strings.");
    }
    url.searchParams.append(key, entry);
  }
}

function readLobRequestHeaders(config: LobAxiosRequestConfig): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(config.headers.toJSON())) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (typeof value === "number" || typeof value === "boolean") {
      headers.set(name, String(value));
    }
  }
  if (config.auth) {
    const credentials = `${config.auth.username}:${config.auth.password}`;
    headers.set(
      "authorization",
      `Basic ${Buffer.from(credentials).toString("base64")}`,
    );
  }
  return headers;
}

function readLobRequestBody(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError("Lob request body must be serialized JSON.");
  }
  return value;
}

function readLobHttpStatus(value: unknown): number | null {
  return value instanceof LobHttpStatusError ? value.status : null;
}

function readLobLetterId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = Reflect.get(value, "id");
  return typeof id === "string" && /^ltr_[A-Za-z0-9]+$/u.test(id)
    ? id
    : null;
}

function readLobLetterLookup(value: unknown): LobPhysicalNoteLookupResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const data = Reflect.get(value, "data");
  if (!Array.isArray(data)) {
    return null;
  }
  if (data.length === 0) {
    return { kind: "absent" };
  }
  if (data.length !== 1) {
    return null;
  }
  const providerLetterId = readLobLetterId(data[0]);
  return providerLetterId
    ? { kind: "accepted", providerLetterId }
    : null;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function requireValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}
