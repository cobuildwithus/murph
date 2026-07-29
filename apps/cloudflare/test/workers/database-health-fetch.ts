import { buildMetricsBody } from "../helpers/database-health.ts";

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
      === "token service-token-id:service-token"
  ) {
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
    return new Response(buildMetricsBody({
      branchId: "branch_worker_test",
      clientWaitSeconds: 8,
    }));
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
    && url.pathname === "/api/partner/v3/chats/chat_worker_test"
    && headers.get("authorization") === "Bearer linq-token"
  ) {
    return Response.json({
      handles: [
        {
          handle: "+12025550122",
          is_me: true,
          service: "iMessage",
          status: "active",
        },
        {
          handle: "+12025550123",
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
    && isValidDatabaseHealthMessageRequest({
      body: init?.body,
      headers,
    })
  ) {
    return new Response(null, { status: 202 });
  }
  return new Response("Unexpected database health egress.", { status: 400 });
}

function isValidDatabaseHealthMessageRequest(input: {
  body: BodyInit | null | undefined;
  headers: Headers;
}): boolean {
  const idempotencyKey = input.headers.get("idempotency-key");
  if (typeof input.body !== "string") {
    return false;
  }
  let value: unknown;
  try {
    value = JSON.parse(input.body);
  } catch {
    return false;
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
    || !value.message.parts[0].value.includes("PgBouncer wait 8s")
    || !Array.isArray(value.to)
    || value.to.length !== 1
    || value.to[0] !== "+12025550123"
    || "from" in value
  ) {
    return false;
  }
  return typeof idempotencyKey === "string" && idempotencyKey.length > 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
