import "server-only";

import { randomUUID } from "node:crypto";
import type { HostedMcpConnection, Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { activeHostedPersonAccessWhere } from "../hosted-onboarding/member-access";
import { connectionMemberAllowed } from "./access";
import { approvedSnapshot, digest, storedToolsSchema, type StoredTool } from "./catalog";
import { ConnectionError } from "./errors";

export type ConnectionRow = HostedMcpConnection;
export function connectionWhere(memberId: string): Prisma.HostedMcpConnectionWhereInput {
  if (!connectionMemberAllowed(memberId)) throw new ConnectionError("not_found", 404);
  return { memberId, member: activeHostedPersonAccessWhere() };
}
export async function readConnection(memberId: string, id: string, prisma: Pick<Prisma.TransactionClient, "hostedMcpConnection"> = getPrisma()): Promise<ConnectionRow> {
  const row = await prisma.hostedMcpConnection.findFirst({ where: { ...connectionWhere(memberId), id } });
  if (!row) throw new ConnectionError("not_found", 404);
  return row;
}
export function projectConnection(row: ConnectionRow) {
  return {
    id: row.id, slug: row.slug, name: row.name, host: new URL(row.serverUrl).host,
    status: row.status, auth: row.auth, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    tools: storedToolsSchema.parse(row.tools).map(({ definition, state }) => ({
      name: definition.name, title: definition.title ?? definition.name, description: definition.description ?? "",
      readOnly: definition.annotations?.readOnlyHint === true, state,
    })),
  };
}
export async function saveCatalog(row: ConnectionRow, tools: StoredTool[], status?: "on" | "off", prisma: Pick<Prisma.TransactionClient, "hostedMcpConnection"> = getPrisma()) {
  const result = await prisma.hostedMcpConnection.updateMany({
    where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation, revision: row.revision },
    data: { tools: JSON.parse(JSON.stringify(tools)), catalog: digest(approvedSnapshot(tools)), revision: { increment: 1 }, ...(status ? { status } : {}) },
  });
  if (result.count !== 1) throw new ConnectionError("conflict", 409);
  return readConnection(row.memberId, row.id, prisma);
}
export async function markNeedsSignIn(row: ConnectionRow, claim?: string) {
  await getPrisma().hostedMcpConnection.updateMany({
    where: { id: row.id, generation: row.generation, tokenVersion: row.tokenVersion,
      status: row.status, ...(claim ? { refreshClaim: claim } : {}) },
    data: { status: "needs_sign_in", refreshClaim: null, refreshExpiresAt: null },
  });
}
export async function claimRefresh(row: ConnectionRow): Promise<string> {
  const prisma = getPrisma();
  if (row.refreshClaim && row.refreshExpiresAt && row.refreshExpiresAt <= new Date()) {
    await markNeedsSignIn(row, row.refreshClaim);
    throw new ConnectionError("needs_sign_in");
  }
  if (row.status === "needs_sign_in") throw new ConnectionError("needs_sign_in");
  const claim = randomUUID();
  const result = await prisma.hostedMcpConnection.updateMany({
    where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation,
      tokenVersion: row.tokenVersion, revision: row.revision, status: row.status, refreshClaim: null },
    data: { refreshClaim: claim, refreshExpiresAt: new Date(Date.now() + 30_000) },
  });
  if (result.count !== 1) throw new ConnectionError("conflict", 409);
  return claim;
}
