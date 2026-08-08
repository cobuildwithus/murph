import { vi } from "vitest";

export function stubAlertEnvironment(): void {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv(
    "HOSTED_LINQ_ALERT_EMAIL_FROM",
    "Murph Alerts <alerts@example.com>",
  );
  vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
}

export function createResendFetch() {
  return vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ id: "email_123" }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    },
  ));
}

export function makeStripeProviderError(input: {
  requestId?: string;
} = {}): Error {
  return Object.assign(new Error("Stripe API unavailable"), {
    rawType: "api_error",
    ...(input.requestId ? { requestId: input.requestId } : {}),
    statusCode: 503,
    type: "StripeAPIError",
  });
}

export function readResendRequest(
  fetchMock: ReturnType<typeof createResendFetch>,
  index: number,
): { body: string; idempotencyKey: string } {
  const request = fetchMock.mock.calls[index]?.[1];
  const headers = request?.headers;
  const body = request?.body;
  if (
    !headers ||
    Array.isArray(headers) ||
    headers instanceof Headers ||
    typeof body !== "string"
  ) {
    throw new TypeError("Expected a plain Resend request.");
  }
  const idempotencyKey = Reflect.get(headers, "Idempotency-Key");
  if (typeof idempotencyKey !== "string") {
    throw new TypeError("Expected a Resend idempotency key.");
  }
  return { body, idempotencyKey };
}
