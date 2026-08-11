import "server-only";

import { Buffer } from "node:buffer";

import type {
  HostedPhysicalNoteFailureReason,
  HostedPhysicalNoteRecipient,
} from "@murphai/hosted-execution/physical-notes";

const LOB_API_BASE_URL = "https://api.lob.com";
const LOB_API_VERSION = "2024-01-01";
const LOB_LOOKUP_TIMEOUT_MS = 5_000;
const LOB_REQUEST_TIMEOUT_MS = 30_000;
const PHYSICAL_NOTE_METADATA_KEY = "murph_physical_note_id";

export type LobPhysicalNoteCreateResult =
  | {
      kind: "accepted";
      providerLetterId: string;
    }
  | {
      kind: "definite_failure";
      reason: HostedPhysicalNoteFailureReason;
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
      let response: Response;
      try {
        response = await fetchImpl(`${LOB_API_BASE_URL}/v1/letters`, {
          body: JSON.stringify({
            address_placement: "insert_blank_page",
            color: true,
            double_sided: true,
            file: renderPhysicalNoteHtml(request.artworkUrl),
            from: fromAddressId,
            mail_type: "usps_first_class",
            metadata: {
              [PHYSICAL_NOTE_METADATA_KEY]: request.noteId,
            },
            size: "us_letter",
            to: {
              address_city: request.recipient.city,
              address_country: "US",
              address_line1: request.recipient.addressLine1,
              ...(request.recipient.addressLine2
                ? { address_line2: request.recipient.addressLine2 }
                : {}),
              address_state: request.recipient.state,
              address_zip: request.recipient.postalCode,
              name: request.recipient.name,
            },
            use_type: "operational",
          }),
          headers: {
            authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
            "content-type": "application/json",
            "Idempotency-Key": request.idempotencyKey,
            "Lob-Version": LOB_API_VERSION,
          },
          method: "POST",
          redirect: "error",
          signal,
        });
      } catch {
        return { kind: "ambiguous_failure" };
      }

      if (!response.ok) {
        return response.status === 408 || response.status >= 500
          ? { kind: "ambiguous_failure" }
          : {
              kind: "definite_failure",
              reason: await readLobFailureReason(response),
              status: response.status,
            };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: "ambiguous_failure" };
      }
      const providerLetterId = readLobLetterId(payload);
      return providerLetterId
        ? { kind: "accepted", providerLetterId }
        : { kind: "ambiguous_failure" };
    },
    async findLetterByNoteId(request) {
      request.signal?.throwIfAborted();
      const signal = request.signal
        ? AbortSignal.any([
            request.signal,
            AbortSignal.timeout(LOB_LOOKUP_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(LOB_LOOKUP_TIMEOUT_MS);
      const url = new URL("/v1/letters", LOB_API_BASE_URL);
      url.searchParams.set("limit", "2");
      url.searchParams.set(
        `metadata[${PHYSICAL_NOTE_METADATA_KEY}]`,
        request.noteId,
      );

      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
            "Lob-Version": LOB_API_VERSION,
          },
          method: "GET",
          redirect: "error",
          signal,
        });
      } catch {
        return { kind: "indeterminate" };
      }

      if (!response.ok) {
        return { kind: "indeterminate" };
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: "indeterminate" };
      }
      return readLobLetterLookup(payload) ?? { kind: "indeterminate" };
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

function readLobLetterId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = Reflect.get(value, "id");
  return typeof id === "string" && /^ltr_[A-Za-z0-9]+$/u.test(id)
    ? id
    : null;
}

async function readLobFailureReason(
  response: Response,
): Promise<HostedPhysicalNoteFailureReason> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return "unknown";
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "unknown";
  }
  const error = Reflect.get(payload, "error");
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return "unknown";
  }
  const code = Reflect.get(error, "code");
  if (typeof code !== "string") {
    return "unknown";
  }

  switch (code.toLowerCase()) {
    case "address_length_exceeds_limit":
    case "failed_deliverability_strictness":
      return "recipient_address";
    case "file_pages_below_min":
    case "file_pages_exceed_max":
    case "file_size_exceeds_limit":
    case "inconsistent_page_dimensions":
    case "invalid_file":
    case "invalid_file_dimensions":
    case "invalid_file_download_time":
    case "invalid_file_url":
    case "invalid_image_dpi":
    case "invalid_template_html":
    case "pdf_encrypted":
    case "unembedded_fonts":
      return "artwork";
    case "billing_address_required":
    case "custom_envelope_inventory_depleted":
    case "email_required":
    case "feature_limit_reached":
    case "foreign_return_address":
    case "invalid_api_key":
    case "invalid_country_covid":
    case "not_found":
    case "payment_method_unverified":
    case "publishable_key_not_allowed":
    case "rate_limit_exceeded":
    case "unauthorized":
    case "unauthorized_token":
      return "service_unavailable";
    case "bad_request":
    case "conflict":
    case "invalid":
    case "invalid_international_feature":
    case "invalid_perforation_return_envelope":
    case "mail_use_type_can_not_be_null":
    case "merge_variable_required":
    case "merge_variable_whitespace":
    case "special_characters_restricted":
    case "unrecognized_endpoint":
    case "unsupported_lob_version":
      return "request_invalid";
    default:
      return "unknown";
  }
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
