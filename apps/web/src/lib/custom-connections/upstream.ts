import "server-only";

import { Client, StreamableHTTPClientTransport, auth } from "@modelcontextprotocol/client";
import { getPrisma } from "../prisma";
import { ConnectionOAuthProvider, type ConnectionCredentials } from "./oauth";
import { guardedConnectionFetch } from "./guarded-fetch";
import { ConnectionError } from "./errors";
import { openConnectionSecret, sealConnectionSecret } from "./secrets";
import { claimRefresh, connectionWhere, markNeedsSignIn, readConnection, type ConnectionRow } from "./store";

export async function readCredentials(row: ConnectionRow): Promise<ConnectionCredentials | undefined> {
  if (!row.credentialsEncrypted) return undefined;
  // Only this module and the authenticated OAuth completion writer seal this shape.
  return await openConnectionSecret(row.memberId, row.id, row.generation, "credentials", row.credentialsEncrypted) as ConnectionCredentials;
}
export async function connectionAccessToken(row: ConnectionRow, forceRefresh = false): Promise<string | undefined> {
  const credentials = await readCredentials(row);
  if (row.auth === "none") return undefined;
  if (!credentials?.tokens) throw new ConnectionError("needs_sign_in");
  if (!forceRefresh && (credentials.expiresAt === undefined || credentials.expiresAt > Date.now() + 30_000)) return credentials.tokens.access_token;
  const claim = await claimRefresh(row);
  try {
    const provider = new ConnectionOAuthProvider(row.id, row.serverUrl, {
      credentials,
      saveTokens: async (next) => {
        const encrypted = await sealConnectionSecret(row.memberId, row.id, row.generation, "credentials", next);
        const result = await getPrisma().hostedMcpConnection.updateMany({
          where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation,
            tokenVersion: row.tokenVersion, refreshClaim: claim, refreshExpiresAt: { gt: new Date() } },
          data: { credentialsEncrypted: encrypted, tokenVersion: { increment: 1 }, refreshClaim: null, refreshExpiresAt: null },
        });
        if (result.count !== 1) throw new ConnectionError("conflict", 409);
      },
    });
    if (await auth(provider, { serverUrl: row.serverUrl, fetchFn: provider.fetch }) !== "AUTHORIZED") throw new ConnectionError("needs_sign_in");
    return provider.tokens()?.access_token;
  } catch {
    await markNeedsSignIn(row, claim);
    throw new ConnectionError("needs_sign_in");
  }
}

/** Every operation owns its entire SDK lifecycle; no remote session survives it. */
// The relay waits 30 s; finish first so Web never works on after Codex has its answer.
const CONNECTION_OPERATION_MS = 24_000;

export async function withConnectionClient<T>(row: ConnectionRow, operation: (client: Client, options: { signal: AbortSignal; timeout: number }) => Promise<T>, provider?: ConnectionOAuthProvider): Promise<T> {
  const deadline = AbortSignal.timeout(CONNECTION_OPERATION_MS);
  const startedAt = Date.now();
  const remaining = () => Math.max(1, CONNECTION_OPERATION_MS - (Date.now() - startedAt));
  let token = provider ? undefined : await raceDeadline(connectionAccessToken(row), deadline);
  const fetchRemote = provider?.fetch ?? guardedConnectionFetch;
  let requests = 0;
  let unauthorizedResponses = 0;
  const transport = new StreamableHTTPClientTransport(new URL(row.serverUrl), {
    authProvider: provider ?? (token ? {
      token: async () => token,
      onUnauthorized: async () => {
        const current = await readConnection(row.memberId, row.id);
        if (current.generation !== row.generation || current.status !== row.status || current.revision !== row.revision) throw new ConnectionError("conflict", 409);
        // A different request may already have committed a successor.
        token = await connectionAccessToken(current, current.tokenVersion === row.tokenVersion);
      },
    } : undefined),
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 },
    fetch: async (url, init = {}) => {
      if (++requests > 24) throw new ConnectionError("limit");
      if (!provider && new URL(String(url)).href !== row.serverUrl) throw new ConnectionError("unsafe_destination");
      const response = await fetchRemote(url, { ...init,
        signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
      if (!provider && row.auth === "none" && (response.status === 401 || response.status === 403)) {
        await response.body?.cancel();
        throw new ConnectionError("refused_by_service");
      }
      if (!provider && ((response.status === 401 && (++unauthorizedResponses > 1 || !token)) || response.status === 403)) {
        await response.body?.cancel();
        const current = await readConnection(row.memberId, row.id);
        if (current.generation === row.generation) await markNeedsSignIn(current);
        throw new ConnectionError("needs_sign_in");
      }
      return response;
    },
  });
  const client = new Client({ name: "murph-custom-connections", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport, { signal: deadline, timeout: remaining() });
    const result = await operation(client, { signal: deadline, timeout: remaining() });
    // A tool that echoes the member's token would hand it to the model and the container.
    if (token && JSON.stringify(result).includes(token)) throw new ConnectionError("refused_result");
    return result;
  } finally {
    if (transport.sessionId) await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
export async function listConnectionTools(row: ConnectionRow, provider?: ConnectionOAuthProvider) {
  return (await describeConnection(row, provider)).tools;
}
/** The server's tools and the name it gives itself (a claim, used only for display and the tool prefix). */
export async function describeConnection(row: ConnectionRow, provider?: ConnectionOAuthProvider) {
  return withConnectionClient(row, async (client, options) => {
    const tools = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await client.listTools(cursor ? { cursor } : undefined, options);
      tools.push(...result.tools);
      if (tools.length > 100) throw new ConnectionError("limit");
      cursor = result.nextCursor;
      if (!cursor) {
        const server = client.getServerVersion();
        return { tools, serverName: server?.title ?? server?.name };
      }
    }
    throw new ConnectionError("limit");
  }, provider);
}

async function raceDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) throw new ConnectionError("unreachable");
  return await Promise.race([work, new Promise<never>((_, reject) => {
    deadline.addEventListener("abort", () => reject(new ConnectionError("unreachable")), { once: true });
  })]);
}
