import "server-only";

import { randomUUID } from "node:crypto";
import type { HostedMcpConnection, Prisma } from "@prisma/client";
import { getPrisma } from "../prisma";
import { activeHostedPersonAccessWhere } from "../hosted-onboarding/member-access";
import { approvedSnapshot, digest, normalizeTools, storedToolsSchema, type StoredTool } from "./catalog";
import { ConnectionError } from "./errors";

export type ConnectionRow = HostedMcpConnection;
export function connectionWhere(memberId: string): Prisma.HostedMcpConnectionWhereInput {
  return { memberId, member: activeHostedPersonAccessWhere() };
}
export async function readConnection(memberId: string, id: string, prisma: Pick<Prisma.TransactionClient, "hostedMcpConnection"> = getPrisma()): Promise<ConnectionRow> {
  const row = await prisma.hostedMcpConnection.findFirst({ where: { ...connectionWhere(memberId), id } });
  if (!row) throw new ConnectionError("not_found", 404);
  return row;
}
/** `changesAllowed`: whether this account can approve changes; when it can't, its writes show off and locked. */
export function projectConnection(row: ConnectionRow, changesAllowed: boolean) {
  return {
    id: row.id, revision: row.revision, slug: row.slug, name: row.name, host: new URL(row.serverUrl).host,
    status: row.status, auth: row.auth, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    changesAllowed,
    // Settings shows what this Web enforces: after normalization only an oversized tool is not_allowed.
    tools: normalizeTools(storedToolsSchema.parse(row.tools)).map(({ definition, state }) => {
      const readOnly = definition.annotations?.readOnlyHint === true;
      return { name: definition.name, title: definition.title ?? definition.name, description: definition.description ?? "",
        readOnly, state: changesAllowed || readOnly || state === "not_allowed" ? state : "off" as const };
    }),
  };
}
export async function saveCatalog(row: ConnectionRow, tools: StoredTool[], status?: "on" | "off", prisma: Pick<Prisma.TransactionClient, "hostedMcpConnection"> = getPrisma()) {
  // A write's served description names the server, so the token reads the name this save leaves in place.
  const { name } = await readConnection(row.memberId, row.id, prisma);
  const result = await prisma.hostedMcpConnection.updateMany({
    where: { ...connectionWhere(row.memberId), id: row.id, generation: row.generation, revision: row.revision },
    data: { tools: JSON.parse(JSON.stringify(tools)), catalog: digest(approvedSnapshot(tools, name)), revision: { increment: 1 }, ...(status ? { status } : {}) },
  });
  if (result.count !== 1) throw new ConnectionError("conflict", 409);
  return readConnection(row.memberId, row.id, prisma);
}
/** Bookkeeping only: it never turns a finished call into an error. */
export async function markConnectionUsed(row: ConnectionRow) {
  try {
    await getPrisma().hostedMcpConnection.updateMany({ where: { id: row.id, generation: row.generation, status: "on" }, data: { lastUsedAt: new Date() } });
  } catch { /* The call already happened; a missed timestamp changes nothing. */ }
}
export async function markNeedsSignIn(row: ConnectionRow, claim?: string) {
  await getPrisma().hostedMcpConnection.updateMany({
    where: { id: row.id, generation: row.generation, tokenVersion: row.tokenVersion,
      status: row.status, ...(claim ? { refreshClaim: claim } : {}) },
    // A new revision makes any open Settings page reload before it can save over this.
    data: { status: "needs_sign_in", refreshClaim: null, refreshExpiresAt: null, revision: { increment: 1 } },
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

// Names the model already knows mean something else; a service can't take them as its tool prefix.
const RESERVED_SLUGS = /^(murph|codex|openai|mcp|functions|shell|web|connected_apps|multi_tool_use)(_|$)/u;

/** A short display name from the server's own claim; never one that reads as Murph itself. */
export function connectionDisplayName(claimed: string | undefined, host: string): string {
  const cleaned = (claimed ?? "").replace(/[\p{C}]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 40);
  return cleaned && !/murph/iu.test(cleaned) ? cleaned : host;
}
/** The Codex tool prefix for a connection: lowercase letters, digits and underscores. */
export function connectionSlug(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 24).replace(/_+$/u, "");
  const slug = /^[a-z]/u.test(base) ? base : `s_${base}`.slice(0, 24);
  return slug === "s_" ? "service" : RESERVED_SLUGS.test(slug) ? `svc_${slug}`.slice(0, 24) : slug;
}
/** Gives a new connection its name and tool prefix once its server has answered. */
export async function nameConnection(row: ConnectionRow, claimed: string | undefined, prisma: Pick<Prisma.TransactionClient, "hostedMcpConnection">) {
  const host = new URL(row.serverUrl).hostname;
  if (row.name !== host) return;
  const name = connectionDisplayName(claimed, host);
  const base = connectionSlug(name);
  const taken = new Set((await prisma.hostedMcpConnection.findMany({ where: { memberId: row.memberId, NOT: { id: row.id } }, select: { slug: true } })).map((other) => other.slug));
  const slug = [base, ...Array.from({ length: 8 }, (_, index) => `${base}_${index + 2}`)].find((candidate) => !taken.has(candidate));
  if (!slug) return;
  await prisma.hostedMcpConnection.updateMany({ where: { id: row.id, generation: row.generation, name: host }, data: { name, slug } });
}
