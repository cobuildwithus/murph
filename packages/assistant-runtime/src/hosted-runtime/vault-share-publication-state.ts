import path from "node:path";

import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
} from "@murphai/hosted-execution/vault-share";
import {
  readVersionedJsonStateFile,
  resolveAssistantStatePaths,
  writeAssistantStateVersionedJson,
} from "@murphai/runtime-state/node";

const HOSTED_VAULT_SHARE_PUBLICATIONS_SCHEMA =
  "murph.hosted-vault-share.projection-publications.v1";
const HOSTED_VAULT_SHARE_PUBLICATIONS_SCHEMA_VERSION = 1;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export const HOSTED_VAULT_SHARE_PUBLICATIONS_RELATIVE_PATH =
  ".runtime/operations/assistant/hosted-vault-share-publications.json";

const KNOWN_PROJECTION_SCOPE_KEYS = new Set(
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES.map(
    buildHostedVaultShareProjectionScopeKey,
  ),
);
const MAX_PUBLICATION_STATE_ENTRIES = KNOWN_PROJECTION_SCOPE_KEYS.size;

export interface HostedVaultShareProjectionPublication {
  contentDigest: string;
  generationToken: string;
}

export interface HostedVaultShareProjectionPublicationState {
  publicationsByProjectionScopeKey: Record<
    string,
    HostedVaultShareProjectionPublication
  >;
}

export function emptyHostedVaultShareProjectionPublicationState():
  HostedVaultShareProjectionPublicationState {
  return { publicationsByProjectionScopeKey: {} };
}

export function resolveHostedVaultShareProjectionPublicationStatePath(
  vaultRoot: string,
): string {
  return path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    "hosted-vault-share-publications.json",
  );
}

export async function readHostedVaultShareProjectionPublicationState(
  vaultRoot: string,
): Promise<HostedVaultShareProjectionPublicationState> {
  try {
    return (await readVersionedJsonStateFile({
      currentPath: resolveHostedVaultShareProjectionPublicationStatePath(
        vaultRoot,
      ),
      label: "Hosted vault-share projection publication state",
      parseValue: parseHostedVaultShareProjectionPublicationState,
      schema: HOSTED_VAULT_SHARE_PUBLICATIONS_SCHEMA,
      schemaVersion: HOSTED_VAULT_SHARE_PUBLICATIONS_SCHEMA_VERSION,
    })).value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyHostedVaultShareProjectionPublicationState();
    }
    throw error;
  }
}

export async function writeHostedVaultShareProjectionPublicationState(input: {
  state: HostedVaultShareProjectionPublicationState;
  vaultRoot: string;
}): Promise<void> {
  await writeAssistantStateVersionedJson({
    filePath: resolveHostedVaultShareProjectionPublicationStatePath(
      input.vaultRoot,
    ),
    schema: HOSTED_VAULT_SHARE_PUBLICATIONS_SCHEMA,
    schemaVersion: HOSTED_VAULT_SHARE_PUBLICATIONS_SCHEMA_VERSION,
    value: normalizeHostedVaultShareProjectionPublicationState(input.state),
  });
}

export function upsertHostedVaultShareProjectionPublication(
  state: HostedVaultShareProjectionPublicationState,
  input: {
    contentDigest: string;
    generationToken: string;
    projectionScopeKey: string;
  },
): HostedVaultShareProjectionPublicationState {
  const next = normalizeHostedVaultShareProjectionPublicationState(state);
  if (
    !KNOWN_PROJECTION_SCOPE_KEYS.has(input.projectionScopeKey)
    || !isDigestLike(input.generationToken)
    || !isDigestLike(input.contentDigest)
  ) {
    return next;
  }
  next.publicationsByProjectionScopeKey[input.projectionScopeKey] = {
    contentDigest: input.contentDigest,
    generationToken: input.generationToken,
  };
  return normalizeHostedVaultShareProjectionPublicationState(next);
}

function parseHostedVaultShareProjectionPublicationState(
  value: unknown,
): HostedVaultShareProjectionPublicationState {
  return normalizeHostedVaultShareProjectionPublicationState(value);
}

function normalizeHostedVaultShareProjectionPublicationState(
  state: unknown,
): HostedVaultShareProjectionPublicationState {
  const publicationsByProjectionScopeKey = isPlainObject(state)
    ? state.publicationsByProjectionScopeKey
    : null;
  const publications = isPlainObject(publicationsByProjectionScopeKey)
    ? publicationsByProjectionScopeKey
    : {};
  const entries: Array<[string, HostedVaultShareProjectionPublication]> = [];

  for (const projectionScopeKey of [...KNOWN_PROJECTION_SCOPE_KEYS].sort()) {
    const publication = publications[projectionScopeKey];
    if (
      !isPlainObject(publication)
      || !isDigestLike(publication.generationToken)
      || !isDigestLike(publication.contentDigest)
    ) {
      continue;
    }
    entries.push([
      projectionScopeKey,
      {
        contentDigest: publication.contentDigest,
        generationToken: publication.generationToken,
      },
    ]);
    if (entries.length >= MAX_PUBLICATION_STATE_ENTRIES) {
      break;
    }
  }

  return {
    publicationsByProjectionScopeKey: Object.fromEntries(entries),
  };
}

function isDigestLike(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
