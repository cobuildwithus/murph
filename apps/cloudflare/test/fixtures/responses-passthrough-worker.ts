import { handleHostedRunnerOpenAiOutbound } from "../../src/runner-egress-intercept.ts";
import { HOSTED_RUNNER_BOUND_USER_ID_HEADER } from "../../src/runner-outbound/headers.ts";
import type { RunnerOutboundEnvironmentSource } from "../../src/runner-outbound.ts";

// Synthetic control plane and provider. Only the production intercept sits
// between the real native Codex client and the separately fetched upstream.
const networkFetch = globalThis.fetch;
let allowed = true;
let authorized = true;
let connections = 0;
let websocketRequests = 0;
let httpRequests = 0;
let accessChecks = 0;
let sequence = 0;
let closeNextRequest = false;

interface TestEnvironment extends RunnerOutboundEnvironmentSource { TEST_OWNER: string }

export default {
  async fetch(request: Request, env: TestEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/control") {
      if (url.searchParams.has("allowed")) allowed = url.searchParams.get("allowed") === "true";
      if (url.searchParams.has("authorized")) authorized = url.searchParams.get("authorized") === "true";
      if (url.searchParams.has("close")) closeNextRequest = true;
      return Response.json({ connections, websocketRequests, httpRequests, accessChecks });
    }
    if (url.pathname === "/upstream") {
      if (request.headers.get("authorization") !== "Bearer synthetic-provider-key") return new Response(null, { status: 401 });
      if (request.headers.get("upgrade") === "websocket") {
        connections++;
        const pair = new WebSocketPair();
        const provider = pair[1];
        provider.accept();
        provider.addEventListener("close", () => provider.close());
        provider.addEventListener("message", (message) => {
          const body = JSON.parse(String(message.data)) as { generate?: boolean };
          if (body.generate !== false) websocketRequests++;
          if (closeNextRequest) {
            closeNextRequest = false;
            provider.close(1012, "synthetic restart");
            return;
          }
          for (const event of responseEvents(body.generate === false)) provider.send(JSON.stringify(event));
        });
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      httpRequests++;
      return new Response(responseEvents(false).map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    }
    globalThis.fetch = async (target, init) => {
      const control = new Request(target, init);
      const controlUrl = new URL(control.url);
      if (controlUrl.hostname !== "web.example.test") throw new Error("Unexpected control host");
      if (controlUrl.pathname.endsWith("/image-generation/access")) {
        accessChecks++;
        return Response.json({ allowed, reason: allowed ? "allowed" : "subscription_required" });
      }
      if (controlUrl.pathname.endsWith("/hosted-runtime/owner")) return Response.json({
        cutover: "postgres", status: authorized ? "authorized" : "stale",
        owner: authorized ? JSON.parse(env.TEST_OWNER) : null,
      });
      throw new Error("Unexpected control route");
    };
    const headers = new Headers(request.headers);
    headers.set(HOSTED_RUNNER_BOUND_USER_ID_HEADER, "member_123");
    headers.set("x-hosted-runtime-attempt-id", "attempt_1");
    headers.set("x-hosted-runtime-lease-generation", "7");
    headers.set("x-hosted-runtime-workspace-version", "4");
    return handleHostedRunnerOpenAiOutbound(new Request(`https://api.openai.com${url.pathname}`, {
      method: request.method, headers, body: request.body,
    }), {
      ...env,
      RUNNER_CONTAINER: { getByName: () => ({ runtimeUsageSettlementAllowsProviders: async () => true }) },
    }, { containerId: "member_123--v-test" }, async (target, init) => {
      const upstream = new Request(target, init);
      return networkFetch(new Request(`${url.origin}/upstream`, upstream));
    });
  },
};

function responseEvents(prewarm: boolean) {
  const id = `resp_synthetic_${++sequence}`;
  const item = {
    type: "message", id: `msg_${id}`, role: "assistant", status: "completed",
    content: [{ type: "output_text", text: "PASSTHROUGH_OK", annotations: [] }],
  };
  const response = {
    id, model: "gpt-5.6-terra", status: "completed", output: prewarm ? [] : [item],
    usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19, input_tokens_details: { cached_tokens: 0 } },
  };
  return [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    ...prewarm ? [] : [
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress" } },
      { type: "response.output_item.done", output_index: 0, item },
    ],
    { type: "response.completed", response },
  ];
}
