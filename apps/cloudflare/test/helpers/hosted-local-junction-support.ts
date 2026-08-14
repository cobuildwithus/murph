import {
  createServer,
  type Server as HttpServer,
} from "node:http";

import {
  buildHostLoopbackStubBaseUrl,
  readRequestBody,
  stopHttpStubServer,
  writeJsonResponse,
} from "./hosted-local-e2e-support.js";

export interface ObservedJunctionRequest {
  authorizationHeaderPresent: boolean;
  body: string;
  method: string;
  url: string;
}

export interface HostedLocalJunctionStub {
  baseUrl: string;
  observedRequests: ObservedJunctionRequest[];
  /** Requests accepted by POST /v2/link/token, in arrival order. */
  linkTokenRequests: Array<{
    provider: string | null;
    redirectUrl: string;
    userId: string;
  }>;
  /** The Junction user id the stub resolves for every client_user_id. */
  junctionUserId: string;
  stop(): Promise<void>;
}

const HOSTED_LOCAL_JUNCTION_STUB_USER_ID = "junction_user_local_stub_1";
const HOSTED_LOCAL_JUNCTION_STUB_TEAM_ID = "junction_team_local_stub_1";
const HOSTED_LOCAL_JUNCTION_LINK_WEB_URL =
  "https://link.tryvital.io/?token=hosted-local-junction-stub";

function buildJunctionUserResponse(clientUserId: string): Record<string, unknown> {
  return {
    client_user_id: clientUserId,
    connected_sources: [],
    created_on: "2026-01-01T00:00:00.000Z",
    team_id: HOSTED_LOCAL_JUNCTION_STUB_TEAM_ID,
    user_id: HOSTED_LOCAL_JUNCTION_STUB_USER_ID,
  };
}

/**
 * Fakes the small slice of the Junction API the hosted web Junction Link
 * connect flow calls: user resolve/create and Link token creation. The stub
 * records the redirect_url each Link token request carries so specs can
 * extract the murph_state the web app minted and replay the provider
 * redirect back into the callback route.
 */
export async function startHostedLocalJunctionStub(): Promise<HostedLocalJunctionStub> {
  const observedRequests: ObservedJunctionRequest[] = [];
  const linkTokenRequests: HostedLocalJunctionStub["linkTokenRequests"] = [];

  const server: HttpServer = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    observedRequests.push({
      authorizationHeaderPresent: Boolean(request.headers.authorization ?? request.headers["x-vital-api-key"]),
      body,
      method,
      url,
    });

    if (method === "GET" && url.startsWith("/v2/user/resolve/")) {
      const clientUserId = decodeURIComponent(url.slice("/v2/user/resolve/".length));
      writeJsonResponse(response, 200, buildJunctionUserResponse(clientUserId));
      return;
    }

    if (method === "POST" && (url === "/v2/user/" || url === "/v2/user")) {
      const parsedBody = JSON.parse(body) as { client_user_id?: unknown };
      const clientUserId = typeof parsedBody.client_user_id === "string"
        ? parsedBody.client_user_id
        : "junction_client_user_local_stub_1";
      writeJsonResponse(response, 200, buildJunctionUserResponse(clientUserId));
      return;
    }

    if (method === "POST" && url === "/v2/link/token") {
      let parsedBody: Record<string, unknown>;
      try {
        parsedBody = JSON.parse(body) as Record<string, unknown>;
      } catch {
        writeJsonResponse(response, 400, {
          error: "Expected a JSON Junction Link token payload.",
        });
        return;
      }

      const redirectUrl = typeof parsedBody.redirect_url === "string" ? parsedBody.redirect_url : null;
      const userId = typeof parsedBody.user_id === "string" ? parsedBody.user_id : null;
      if (!redirectUrl || !userId) {
        writeJsonResponse(response, 400, {
          error: "Expected user_id and redirect_url in the Junction Link token payload.",
        });
        return;
      }

      linkTokenRequests.push({
        provider: typeof parsedBody.provider === "string" ? parsedBody.provider : null,
        redirectUrl,
        userId,
      });
      writeJsonResponse(response, 200, {
        link_web_url: HOSTED_LOCAL_JUNCTION_LINK_WEB_URL,
      });
      return;
    }

    writeJsonResponse(response, 404, {
      error: `Unexpected Junction stub request: ${method} ${url}`,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  return {
    baseUrl: buildHostLoopbackStubBaseUrl(server, "Junction stub"),
    junctionUserId: HOSTED_LOCAL_JUNCTION_STUB_USER_ID,
    linkTokenRequests,
    observedRequests,
    stop: async () => {
      await stopHttpStubServer(server);
    },
  };
}
