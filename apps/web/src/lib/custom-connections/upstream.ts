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

/**
 * A member-confirmed write. Sign-in, token refresh and setup may run first; `sent` turns true as its one
 * tools/call leaves Web, and the client never sends another, so the SDK can't repeat it after a 401 or a retry.
 */
export interface ConnectionWrite { sent: boolean }
function admitWrite(write: ConnectionWrite, init: RequestInit): boolean {
  if (init.method !== "POST") return false;
  // The SDK posts JSON-RPC text; anything else fails closed before it is sent.
  const messages: unknown[] = [JSON.parse(String(init.body))].flat();
  if (!messages.some((message) => (message as { method?: unknown } | null)?.method === "tools/call")) return false;
  if (write.sent) throw new ConnectionError("conflict");
  write.sent = true;
  return true;
}
/** A refusal Web answers itself instead of letting the SDK sign in and send the request again. */
function refusal(status: number, auth: string, toolCall: boolean, repeated: boolean, token: string | undefined) {
  if (status !== 401 && status !== 403) return undefined;
  if (auth === "none") return "refused" as const;
  // A write never goes out twice, so a 401 to it is the answer, not a cue to refresh and resend.
  if (toolCall && status === 401) return "refused" as const;
  return status === 403 || repeated || !token ? "signed_out" as const : undefined;
}

export async function withConnectionClient<T>(row: ConnectionRow, operation: (client: Client, options: { signal: AbortSignal; timeout: number }) => Promise<T>, provider?: ConnectionOAuthProvider, write?: ConnectionWrite): Promise<T> {
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
      const toolCall = write ? admitWrite(write, init) : false;
      const response = await fetchRemote(url, { ...init,
        signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
      const refused = provider ? undefined
        : refusal(response.status, row.auth, toolCall, response.status === 401 && ++unauthorizedResponses > 1, token);
      if (!refused) return response;
      await response.body?.cancel();
      if (refused === "refused") throw new ConnectionError("refused_by_service");
      const current = await readConnection(row.memberId, row.id);
      if (current.generation === row.generation) await markNeedsSignIn(current);
      throw new ConnectionError("needs_sign_in");
    },
  });
  // Servers on the 2026-07-28 revision drop the 2025 handshake; let the SDK pick the era.
  const client = new Client({ name: "murph-custom-connections", version: "1.0.0" }, {
    capabilities: {}, listMaxPages: 10, versionNegotiation: { mode: "auto" },
  });
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
    // With no cursor the SDK walks every page itself, up to listMaxPages.
    const { tools } = await client.listTools(undefined, options);
    if (tools.length > 100) throw new ConnectionError("limit");
    const server = client.getServerVersion();
    return { tools, serverName: server?.title ?? server?.name };
  }, provider);
}

async function raceDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  if (deadline.aborted) throw new ConnectionError("unreachable");
  return await Promise.race([work, new Promise<never>((_, reject) => {
    deadline.addEventListener("abort", () => reject(new ConnectionError("unreachable")), { once: true });
  })]);
}
