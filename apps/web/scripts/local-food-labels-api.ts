import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

const usage = `
Local benchmark usage from the repository root, against a loopback labels DB
built with apps/web/sql/foods/import-fdc.sh:
  MURPH_LABELS_DB_URL=postgresql://postgres:postgres@127.0.0.1:5432/<local-db> \\
  NODE_OPTIONS=--conditions=react-server \\
    pnpm exec tsx --tsconfig apps/web/tsconfig.json \\
    apps/web/scripts/local-food-labels-api.ts [--port <port>]

Serves the production /api/foods route handlers as a local stand-in for the
hosted runner's http://murph-data-api.worker egress target. Callers rewrite
that origin to http://127.0.0.1:<port> (the assistant-engine meal intake
benchmark does this in its vault-cli wrapper). The server authorizes requests
itself, like the hosted Worker intercept, so no credential reaches the runner.
It refuses non-loopback database hosts and serves nothing else.
`;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DATA_API_ORIGIN = "http://murph-data-api.worker";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage.trim());
    return;
  }
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? Number.parseInt(args[portIndex + 1] ?? "", 10) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }
  const databaseUrl = process.env.MURPH_LABELS_DB_URL?.trim();
  if (!databaseUrl || !LOOPBACK_HOSTS.has(new URL(databaseUrl).hostname)) {
    throw new Error("MURPH_LABELS_DB_URL must name a loopback labels database.");
  }
  if (!process.execArgv.join(" ").includes("react-server")
    && !(process.env.NODE_OPTIONS ?? "").includes("react-server")) {
    throw new Error("Run with NODE_OPTIONS=--conditions=react-server.");
  }
  const apiKey = randomBytes(24).toString("hex");
  process.env.MURPH_DATA_API_KEY = apiKey;
  const { GET, POST } = await import("../app/api/foods/route");

  const server = createServer((request, response) => {
    void handle(request).then(async (result) => {
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    }, (error: unknown) => {
      console.error("local food labels request failed", error instanceof Error ? error.name : typeof error);
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "local_food_labels_failed" }));
    });
  });

  async function handle(request: IncomingMessage): Promise<Response> {
    // A proxied request carries the absolute runner URL; a direct one carries a path.
    const url = new URL(request.url ?? "/", DATA_API_ORIGIN);
    if (url.origin !== DATA_API_ORIGIN || url.pathname !== "/api/foods") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const headers = new Headers({ authorization: `Bearer ${apiKey}` });
    const contentType = request.headers["content-type"];
    if (contentType) headers.set("content-type", contentType);
    const routeRequest = new Request(url, {
      body: request.method === "POST" ? Buffer.concat(chunks) : undefined,
      headers,
      method: request.method,
    });
    if (request.method === "GET") return await GET(routeRequest);
    if (request.method === "POST") return await POST(routeRequest);
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log(`local food labels API listening on http://127.0.0.1:${boundPort}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
