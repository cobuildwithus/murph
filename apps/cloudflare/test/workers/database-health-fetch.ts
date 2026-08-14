import { buildMetricsBody } from "../helpers/database-health.ts";

interface RecordedDatabaseHealthMessageRequest {
  idempotencyKey: string;
  messageParts: Array<{
    type: string;
    value: string;
  }>;
  recipient: string;
}

const recordedDatabaseHealthMessageRequests:
  RecordedDatabaseHealthMessageRequest[] = [];
let databaseHealthClientWaitSeconds = 8;
let databaseHealthDiscoveryRequestCount = 0;
let databaseHealthMetricsRequestCount = 0;
let databaseHealthMissingConnectionErrorScrapesRemaining = 0;
let databaseHealthNowMs = Date.now();
let databaseHealthPooledErrors = 0;
let databaseHealthZeroEvidenceScrapesRemaining = 0;

export function readDatabaseHealthMessageRequests():
  RecordedDatabaseHealthMessageRequest[] {
  return recordedDatabaseHealthMessageRequests.map((request) => ({
    ...request,
    messageParts: request.messageParts.map((part) => ({ ...part })),
  }));
}

export function readDatabaseHealthPlanetScaleRequestCounts(): {
  discovery: number;
  metrics: number;
} {
  return {
    discovery: databaseHealthDiscoveryRequestCount,
    metrics: databaseHealthMetricsRequestCount,
  };
}

export function resetDatabaseHealthMessageRequests(): void {
  recordedDatabaseHealthMessageRequests.length = 0;
  databaseHealthClientWaitSeconds = 8;
  databaseHealthDiscoveryRequestCount = 0;
  databaseHealthMetricsRequestCount = 0;
  databaseHealthMissingConnectionErrorScrapesRemaining = 0;
  databaseHealthNowMs = Date.now();
  databaseHealthPooledErrors = 0;
  databaseHealthZeroEvidenceScrapesRemaining = 0;
}

export function readDatabaseHealthNowMs(): number {
  return databaseHealthNowMs;
}

export function setDatabaseHealthClientWaitSeconds(value: number): void {
  databaseHealthClientWaitSeconds = value;
}

export function setDatabaseHealthMissingConnectionErrorScrapesRemaining(
  value: number,
): void {
  databaseHealthMissingConnectionErrorScrapesRemaining = value;
}

export function setDatabaseHealthZeroEvidenceScrapesRemaining(
  value: number,
): void {
  databaseHealthZeroEvidenceScrapesRemaining = value;
}

export function setDatabaseHealthNowMs(value: number): void {
  databaseHealthNowMs = value;
}

export function setDatabaseHealthPooledErrors(value: number): void {
  databaseHealthPooledErrors = value;
}

export async function handleDatabaseHealthEgress(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const inputRequest = input instanceof Request ? input : null;
  const url = new URL(
    input instanceof URL
      ? input.href
      : typeof input === "string"
        ? input
        : input.url,
  );
  const method = init?.method ?? inputRequest?.method ?? "GET";
  const headers = new Headers(init?.headers ?? inputRequest?.headers);
  if (
    method === "GET"
    && url.origin === "https://api.planetscale.com"
    && url.pathname === "/v1/organizations/org-worker-test/metrics"
    && headers.get("authorization")
      === "service-token-id:service-token"
  ) {
    databaseHealthDiscoveryRequestCount += 1;
    return Response.json([
      {
        labels: {
          __metrics_path__: "/metrics",
          __param_exp: "2000000000",
          __param_sig: "signed-scrape-token",
          __scheme__: "https",
          planetscale_branch_name: "main",
          planetscale_database_name: "database-worker-test",
          planetscale_organization_name: "org-worker-test",
        },
        targets: ["metrics.planetscale.test"],
      },
    ]);
  }
  if (
    method === "GET"
    && url.origin === "https://metrics.planetscale.test"
    && url.pathname === "/metrics"
    && url.searchParams.get("exp") === "2000000000"
    && url.searchParams.get("sig") === "signed-scrape-token"
    && headers.get("authorization") === null
  ) {
    databaseHealthMetricsRequestCount += 1;
    if (databaseHealthZeroEvidenceScrapesRemaining > 0) {
      databaseHealthZeroEvidenceScrapesRemaining -= 1;
      return new Response("", { status: 200 });
    }
    const metricsBody = buildMetricsBody({
      branchId: "branch_worker_test",
      clientWaitSeconds: databaseHealthClientWaitSeconds,
      pooledErrors: databaseHealthPooledErrors,
    });
    if (databaseHealthMissingConnectionErrorScrapesRemaining > 0) {
      databaseHealthMissingConnectionErrorScrapesRemaining -= 1;
      return new Response(metricsBody.replace(
        /^planetscale_edge_postgres_connection_errors_total.*$/gmu,
        "",
      ));
    }
    return new Response(metricsBody);
  }
  if (
    method === "GET"
    && url.origin === "https://api.linqapp.com"
    && url.pathname === "/api/partner/v3/phone_numbers"
    && headers.get("authorization") === "Bearer linq-token"
  ) {
    return Response.json({
      phone_numbers: [
        {
          phone_number: "+12025550122",
          reputation: { status: "HEALTHY" },
        },
      ],
    });
  }
  if (
    method === "GET"
    && url.origin === "https://api.linqapp.com"
    && (
      url.pathname === "/api/partner/v3/chats/chat_worker_test"
      || url.pathname
        === "/api/partner/v3/chats/chat_worker_secondary_test"
    )
    && headers.get("authorization") === "Bearer linq-token"
  ) {
    const recipient = url.pathname.endsWith("chat_worker_secondary_test")
      ? "+12025550124"
      : "+12025550123";
    return Response.json({
      handles: [
        {
          handle: "+12025550122",
          is_me: true,
          service: "iMessage",
          status: "active",
        },
        {
          handle: recipient,
          is_me: false,
          service: "iMessage",
          status: "active",
        },
      ],
      health_status: { status: "HEALTHY" },
      is_group: false,
    });
  }
  if (
    method === "POST"
    && url.origin === "https://api.linqapp.com"
    && url.pathname === "/api/partner/v3/messages"
    && headers.get("authorization") === "Bearer linq-token"
  ) {
    const messageRequest = readValidDatabaseHealthMessageRequest({
      body: init?.body,
      headers,
    });
    if (messageRequest) {
      recordedDatabaseHealthMessageRequests.push(messageRequest);
      return new Response(null, { status: 202 });
    }
  }
  return new Response("Unexpected database health egress.", { status: 400 });
}

function readValidDatabaseHealthMessageRequest(input: {
  body: BodyInit | null | undefined;
  headers: Headers;
}): RecordedDatabaseHealthMessageRequest | null {
  const idempotencyKey = input.headers.get("idempotency-key");
  if (typeof input.body !== "string") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(input.body);
  } catch {
    return null;
  }
  if (
    !isObjectRecord(value)
    || !isObjectRecord(value.message)
    || value.message.idempotency_key !== idempotencyKey
    || !Array.isArray(value.message.parts)
    || value.message.parts.length !== 1
    || !isObjectRecord(value.message.parts[0])
    || value.message.parts[0].type !== "text"
    || typeof value.message.parts[0].value !== "string"
    || !(
      value.message.parts[0].value.includes("PgBouncer wait ")
      || value.message.parts[0].value.includes(
        "pooled application connection",
      )
    )
    || !Array.isArray(value.to)
    || value.to.length !== 1
    || (
      value.to[0] !== "+12025550123"
      && value.to[0] !== "+12025550124"
    )
    || "from" in value
    || typeof idempotencyKey !== "string"
    || idempotencyKey.length === 0
  ) {
    return null;
  }
  return {
    idempotencyKey,
    messageParts: [{
      type: value.message.parts[0].type,
      value: value.message.parts[0].value,
    }],
    recipient: value.to[0],
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
