import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";

import Stripe from "stripe";

export interface ObservedHostedStripeHttpRequest {
  authorization: string | null;
  body: string;
  method: string;
  pathname: string;
  search: string;
}

export interface HostedStripeHttpFixture {
  observedRequests: ObservedHostedStripeHttpRequest[];
  stop(): Promise<void>;
  stripe: Stripe;
}

export async function startHostedStripeHttpFixture(input: {
  events?: Readonly<Record<string, Stripe.Event>>;
  subscriptions?: Readonly<Record<string, Stripe.Subscription>>;
}): Promise<HostedStripeHttpFixture> {
  const observedRequests: ObservedHostedStripeHttpRequest[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const observed = {
      authorization: readHeader(request.headers, "authorization"),
      body: await readRequestBody(request),
      method: request.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
    } satisfies ObservedHostedStripeHttpRequest;
    observedRequests.push(observed);

    const eventId = readResourceId(url.pathname, "/v1/events/");
    if (observed.method === "GET" && eventId) {
      const event = input.events?.[eventId];
      if (event) {
        writeJsonResponse(response, 200, event);
        return;
      }
      writeStripeNotFound(response, "event", eventId);
      return;
    }

    const subscriptionId = readResourceId(
      url.pathname,
      "/v1/subscriptions/",
    );
    if (observed.method === "GET" && subscriptionId) {
      const subscription = input.subscriptions?.[subscriptionId];
      if (subscription) {
        writeJsonResponse(response, 200, subscription);
        return;
      }
      writeStripeNotFound(response, "subscription", subscriptionId);
      return;
    }

    writeJsonResponse(response, 404, {
      error: {
        code: "resource_missing",
        message: `Unexpected Stripe fixture request: ${observed.method} ${url.pathname}`,
        type: "invalid_request_error",
      },
    });
  });

  await listenOnLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Stripe HTTP fixture did not expose a TCP port.");
  }

  return {
    observedRequests,
    stop: () => closeServer(server),
    stripe: new Stripe("sk_test_hosted_http_fixture", {
      host: "127.0.0.1",
      maxNetworkRetries: 0,
      port: address.port,
      protocol: "http",
      timeout: 5_000,
    }),
  };
}

function readResourceId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const encoded = pathname.slice(prefix.length);
  return encoded ? decodeURIComponent(encoded) : null;
}

function readHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

async function readRequestBody(
  request: AsyncIterable<Uint8Array | string>,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function writeStripeNotFound(
  response: ServerResponse,
  resource: string,
  id: string,
): void {
  writeJsonResponse(response, 404, {
    error: {
      code: "resource_missing",
      message: `No such ${resource}: ${id}`,
      param: "id",
      type: "invalid_request_error",
    },
  });
}

function writeJsonResponse(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "request-id": "req_hosted_stripe_fixture",
  });
  response.end(JSON.stringify(body));
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeAllConnections();
  });
}
