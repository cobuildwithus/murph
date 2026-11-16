import "server-only";

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../prisma";
import { assertHostedAppSessionCurrentTx, type HostedAppSession } from "../hosted-onboarding/app-session";
import { activeHostedPersonAccessWhere } from "../hosted-onboarding/member-access";
import { approvedSnapshot, digest, reconcileTools, storedToolsSchema, approveTools } from "./catalog";
import { ConnectionError } from "./errors";
import { connectionUrl, guardedConnectionFetch } from "./guarded-fetch";
import { completeConnectionAuthorization, ConnectionOAuthProvider, revocationEndpoint, startOfferedAuthorization, type PendingAuthorization } from "./oauth";
import { sealConnectionSecret, openConnectionSecret } from "./secrets";
import { connectionWhere, nameConnection, projectConnection, readConnection, saveCatalog, type ConnectionRow } from "./store";
import { describeConnection, listConnectionTools, readCredentials } from "./upstream";

type SettingsMutation = { request: Request; session: HostedAppSession };
async function settingsMutation<T>(authority: SettingsMutation, operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return getPrisma().$transaction(async (tx) => {
    await assertHostedAppSessionCurrentTx({ memberId: authority.session.member.id, sessionId: authority.session.sessionId,
      authProof: authority.session.authProof, prisma: tx, request: authority.request });
    return operation(tx);
  });
}

export async function addConnection(request: Request, session: HostedAppSession, inputUrl: string) {
  const url = connectionUrl(inputUrl);
  // A query usually carries a key, which would sit unencrypted in server_url.
  if (url.search) throw new ConnectionError("url_has_query");
  const id = `cc_${randomUUID().replaceAll("-", "")}`;
  const row = await getPrisma().$transaction(async (tx) => {
    await assertHostedAppSessionCurrentTx({ memberId: session.member.id, sessionId: session.sessionId, authProof: session.authProof, prisma: tx, request });
    // Serialize connection-count admission with other adds for this member.
    await tx.$queryRaw`SELECT id FROM hosted_member WHERE id = ${session.member.id} FOR UPDATE`;
    if (await tx.hostedMcpConnection.count({ where: { memberId: session.member.id } }) >= 10) throw new ConnectionError("limit");
    return tx.hostedMcpConnection.create({ data: { id, memberId: session.member.id,
      slug: `connection_${id.slice(3)}`, name: url.hostname, serverUrl: url.href, catalog: digest([]) } });
  });
  try {
    const result = await discoverConnection(row, { request, session });
    return result;
  } catch (error) {
    await getPrisma().hostedMcpConnection.deleteMany({ where: { id, generation: row.generation } });
    throw error;
  }
}
async function discoverConnection(row: ConnectionRow, authority: SettingsMutation) {
  const { session } = authority;
  const provider = new ConnectionOAuthProvider(row.id, row.serverUrl, {
    redirect: async (state, pending) => {
      const encrypted = await sealConnectionSecret(row.memberId, row.id, row.generation, "pending", pending);
      await settingsMutation(authority, async (tx) => {
        const changed = await tx.hostedMcpConnection.updateMany({
          where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation, revision: row.revision },
          data: { auth: "oauth", status: "needs_sign_in" },
        });
        if (!changed.count) throw new ConnectionError("conflict", 409);
        await tx.hostedMcpPendingAuthorization.upsert({ where: { connectionId: row.id },
          create: { connectionId: row.id, memberId: row.memberId, sessionBinding: digest(session.sessionId),
            generation: row.generation, stateHash: digest(state), payloadEncrypted: encrypted, expiresAt: new Date(Date.now() + 600_000) },
          update: { sessionBinding: digest(session.sessionId), generation: row.generation, stateHash: digest(state),
            payloadEncrypted: encrypted, expiresAt: new Date(Date.now() + 600_000) },
        });
      });
    },
  });
  const signIn = (url: URL) => ({ next: "sign_in" as const, connectionId: row.id, authorizationUrl: url.href, authorizationHost: url.host });
  // A server that offers sign-in gets it up front, so its tools for the member's own account work.
  if (await startOfferedAuthorization(provider) && provider.authorizationUrl) return signIn(provider.authorizationUrl);
  try {
    const { tools, serverName } = await describeConnection(row, provider);
    const saved = await settingsMutation(authority, async (tx) => {
      await nameConnection(row, serverName, tx);
      return saveCatalog(row, reconcileTools(storedToolsSchema.parse(row.tools), tools), undefined, tx);
    });
    return { next: "choose" as const, connection: projectConnection(saved) };
  } catch (error) {
    if (provider.authorizationUrl) return signIn(provider.authorizationUrl);
    throw error;
  }
}
export async function startConnectionSignIn(row: ConnectionRow, authority: SettingsMutation) {
  const changed = await settingsMutation(authority, (tx) => tx.hostedMcpConnection.updateMany({
    where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation, revision: row.revision },
    data: { generation: { increment: 1 }, revision: { increment: 1 }, status: "needs_sign_in", credentialsEncrypted: null,
      refreshClaim: null, refreshExpiresAt: null },
  }));
  if (!changed.count) throw new ConnectionError("conflict", 409);
  const result = await discoverConnection(await readConnection(row.memberId, row.id), authority);
  if (result.next !== "sign_in") throw new ConnectionError("sign_in_unsupported");
  return { authorizationUrl: result.authorizationUrl, authorizationHost: result.authorizationHost };
}
export async function finishConnectionSignIn(request: Request, session: HostedAppSession, id: string) {
  const query = new URL(request.url).searchParams;
  const state = query.get("state");
  const code = query.get("code");
  if (!state || !code || query.getAll("state").length !== 1 || query.getAll("iss").length > 1 || query.getAll("code").length !== 1) throw new ConnectionError("sign_in_unsupported");
  const prisma = getPrisma();
  const row = await readConnection(session.member.id, id);
  const pending = await prisma.$transaction(async (tx) => {
    await assertHostedAppSessionCurrentTx({ memberId: session.member.id, sessionId: session.sessionId, authProof: session.authProof, prisma: tx, request });
    const found = await tx.hostedMcpPendingAuthorization.findFirst({ where: {
      connectionId: id, memberId: session.member.id, sessionBinding: digest(session.sessionId),
      stateHash: digest(state), generation: row.generation, expiresAt: { gt: new Date() },
      connection: { status: "needs_sign_in", generation: row.generation, member: activeHostedPersonAccessWhere() },
    } });
    if (!found) throw new ConnectionError("sign_in_unsupported");
    const consumed = await tx.hostedMcpPendingAuthorization.deleteMany({ where: { connectionId: id, stateHash: found.stateHash } });
    if (!consumed.count) throw new ConnectionError("sign_in_unsupported");
    return found;
  });
  const payload = await openConnectionSecret(row.memberId, id, row.generation, "pending", pending.payloadEncrypted) as PendingAuthorization;
  const provider = new ConnectionOAuthProvider(id, row.serverUrl, { pending: payload,
    saveTokens: async (credentials) => {
      const encrypted = await sealConnectionSecret(row.memberId, id, row.generation, "credentials", credentials);
      const saved = await settingsMutation({ request, session }, (tx) => tx.hostedMcpConnection.updateMany({ where: {
        ...connectionWhere(row.memberId), id, generation: row.generation, revision: row.revision, status: "needs_sign_in",
      }, data: { credentialsEncrypted: encrypted, auth: "oauth", status: "off", tokenVersion: { increment: 1 } } }));
      if (!saved.count) throw new ConnectionError("conflict", 409);
    },
  });
  await completeConnectionAuthorization(provider, code, query.get("iss") ?? undefined);
  const updated = await readConnection(row.memberId, id);
  const { tools, serverName } = await describeConnection(updated);
  return settingsMutation({ request, session }, async (tx) => {
    await nameConnection(updated, serverName, tx);
    return saveCatalog(updated, reconcileTools(storedToolsSchema.parse(updated.tools), tools), undefined, tx);
  });
}
export async function patchConnection(row: ConnectionRow, input: { revision: number; tools?: Record<string, boolean>; status?: "on" | "off" }, authority: SettingsMutation) {
  // The member approves what they saw; a refresh in between means look again.
  if (input.revision !== row.revision) throw new ConnectionError("conflict", 409);
  // Only completed sign-in leaves needs_sign_in; turning it off and on again must not reuse a refresh token that may be spent.
  if (input.status !== undefined && row.status === "needs_sign_in") throw new ConnectionError("needs_sign_in");
  const tools = approveTools(storedToolsSchema.parse(row.tools), input.tools ?? {});
  return settingsMutation(authority, async (tx) => {
    const result = await saveCatalog(row, tools, input.status, tx);
    if (input.status === "off") await tx.hostedMcpPendingAuthorization.deleteMany({ where: { connectionId: row.id, generation: row.generation } });
    return result;
  });
}
export async function refreshConnection(row: ConnectionRow, authority: SettingsMutation) {
  const definitions = await listConnectionTools(row);
  return settingsMutation(authority, (tx) => saveCatalog(row, reconcileTools(storedToolsSchema.parse(row.tools), definitions), undefined, tx));
}
export async function removeConnection(row: ConnectionRow, authority: SettingsMutation) {
  // Deletion is the local disable commit; provider revocation cannot restore it.
  const removed = await settingsMutation(authority, (tx) => tx.hostedMcpConnection.deleteMany({ where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation } }));
  if (removed.count !== 1) throw new ConnectionError("conflict", 409);
  await revokeConnectionBestEffort(row);
}
/** Asks the service to end Murph's grant. Local removal never depends on it. */
export async function revokeConnectionBestEffort(row: ConnectionRow): Promise<void> {
  try {
    const credentials = await readCredentials(row);
    const endpoint = credentials ? revocationEndpoint(credentials.discovery) : undefined;
    const token = credentials?.tokens?.refresh_token ?? credentials?.tokens?.access_token;
    if (!endpoint || !token || !credentials?.client) return;
    const body = new URLSearchParams({ token, client_id: credentials.client.client_id });
    if (credentials.client.client_secret) body.set("client_secret", credentials.client.client_secret);
    const response = await guardedConnectionFetch(endpoint, { method: "POST", body });
    await response.body?.cancel();
  } catch { /* Local removal is final even when the provider cannot revoke. */ }
}
export async function connectionManifest(memberId: string) {
  const rows = await getPrisma().hostedMcpConnection.findMany({
    where: { ...connectionWhere(memberId), status: "on" }, take: 10, orderBy: { slug: "asc" },
    select: { id: true, slug: true, generation: true, catalog: true, tools: true },
  });
  return { connections: rows.filter((row) => approvedSnapshot(storedToolsSchema.parse(row.tools)).length > 0)
    .map(({ id, slug, generation, catalog }) => ({ id, slug, generation, catalog })) };
}

/** Account deletion: ask each service to end Murph's grant, in parallel and for at most ten seconds. */
export async function revokeCustomConnectionsBestEffort(input: { memberId: string; prisma?: Pick<Prisma.TransactionClient, "hostedMcpConnection"> }): Promise<void> {
  try {
    const rows = await (input.prisma ?? getPrisma()).hostedMcpConnection.findMany({
      where: { memberId: input.memberId, credentialsEncrypted: { not: null } }, take: 10,
    });
    await Promise.race([
      Promise.allSettled(rows.map((row) => revokeConnectionBestEffort(row))),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  } catch { /* Deletion of the local rows is what removes Murph's access. */ }
}
