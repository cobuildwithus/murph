import "server-only";

import { Buffer } from "node:buffer";

import type {
  HostedPhysicalNoteRecipient,
} from "@murphai/hosted-execution/physical-notes";

const LOB_API_BASE_URL = "https://api.lob.com";
const LOB_API_VERSION = "2024-01-01";
const LOB_CREATE_TIMEOUT_MS = 30_000;

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

export interface LobPhysicalNoteRuntime {
  create(input: {
    artworkUrl: string;
    idempotencyKey: string;
    noteId: string;
    recipient: HostedPhysicalNoteRecipient;
    signal?: AbortSignal;
  }): Promise<LobPhysicalNoteCreateResult>;
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
      const signal = request.signal
        ? AbortSignal.any([
            request.signal,
            AbortSignal.timeout(LOB_CREATE_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(LOB_CREATE_TIMEOUT_MS);
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
              murph_physical_note_id: request.noteId,
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
        return response.status >= 500
          ? { kind: "ambiguous_failure" }
          : { kind: "definite_failure", status: response.status };
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
