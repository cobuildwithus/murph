import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface RenderedContainerIdentity {
  applicationName: string;
  className: string;
}

export type WranglerContainerActionKind = "created" | "modified" | "unchanged";

export interface WranglerContainerAction {
  action: WranglerContainerActionKind;
  applicationName: string;
  className: string;
}

/** Raw provider identity retained only long enough to classify this deploy. */
export interface CloudflareContainerApplicationIdentity {
  applicationId: string;
  applicationName: string;
  image: string;
  version: number;
}

export interface ContainerReleaseEntry {
  applicationName: string;
  className: string;
  disposition: "created" | "updated" | "unchanged";
  imageSha256: string;
  version: number;
}

export interface DirectDeployReleaseEvidence {
  containers: readonly ContainerReleaseEntry[];
  workerVersionId: string;
}

export type ReadUtf8File = (
  target: string,
  encoding: "utf8",
) => Promise<string>;

export type ListCloudflareContainerApplications = (
  applicationName: string,
) => Promise<unknown>;

export type CloudflareContainerFetch = (
  input: URL,
  init: RequestInit,
) => Promise<{
  json(): Promise<unknown>;
  ok: boolean;
}>;

export type ContainerApplicationReadPhase = "before" | "after";

const APPLICATION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const CLOUDFLARE_REQUEST_TIMEOUT_MS = 30_000;
const ANSI_OSC_SEQUENCE_PATTERN = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)/gu;
const ANSI_CSI_SEQUENCE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const ANSI_STRING_SEQUENCE_PATTERN = /\u001B[P^_][\s\S]*?\u001B\\/gu;
const ANSI_SINGLE_ESCAPE_PATTERN = /\u001B[@-Z\\-_]/gu;
const OUTPUT_APPLICATION_NAME = "([A-Za-z0-9][A-Za-z0-9._-]*)";

const defaultReadUtf8File: ReadUtf8File = async (target, encoding) =>
  await readFile(target, encoding);
const defaultCloudflareFetch: CloudflareContainerFetch = async (input, init) =>
  await fetch(input, init);

export async function readRenderedContainerIdentities(
  configPath: string,
  readUtf8File: ReadUtf8File = defaultReadUtf8File,
): Promise<RenderedContainerIdentity[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readUtf8File(configPath, "utf8"));
  } catch {
    throw invalidRenderedConfig();
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.containers) || parsed.containers.length === 0) {
    throw invalidRenderedConfig();
  }

  const workerName = readOptionalNonemptyString(parsed, "name");
  const identities = parsed.containers.map((container) => {
    if (!isRecord(container)) {
      throw invalidRenderedConfig();
    }

    const className = readRequiredNonemptyString(container, "class_name", invalidRenderedConfig);
    const explicitName = readOptionalNonemptyString(container, "name");
    if (Reflect.has(container, "name") && !explicitName) {
      throw invalidRenderedConfig();
    }
    if (!explicitName && !workerName) {
      throw invalidRenderedConfig();
    }

    const applicationName = explicitName
      ?? `${workerName}-${className}`.toLowerCase().replaceAll(" ", "-");
    if (!APPLICATION_NAME_PATTERN.test(applicationName)) {
      throw invalidRenderedConfig();
    }

    return { applicationName, className };
  });

  assertUniqueRenderedContainers(identities, invalidRenderedConfig);
  return sortRenderedContainers(identities);
}

export function parseWranglerContainerActions(
  output: string,
  expectedContainers: readonly RenderedContainerIdentity[],
): WranglerContainerAction[] {
  assertUniqueRenderedContainers(expectedContainers, invalidWranglerActions);
  const expectedByApplication = new Map(
    expectedContainers.map((container) => [container.applicationName, container]),
  );
  const observed: Array<{ action: WranglerContainerActionKind; applicationName: string }> = [];

  for (const line of stripAnsi(output).replaceAll("\r", "\n").split("\n")) {
    const created = matchOutputAction(
      line,
      new RegExp(
        `(?:^|[^A-Za-z0-9._-])Created application ${OUTPUT_APPLICATION_NAME}`
          + "(?: \\(Application ID: [^)]+\\))?[^A-Za-z0-9._-]*$",
        "u",
      ),
    );
    const modified = matchOutputAction(
      line,
      new RegExp(
        `(?:^|[^A-Za-z0-9._-])Modified application ${OUTPUT_APPLICATION_NAME}`
          + "(?: \\(Application ID: [^)]+\\))?[^A-Za-z0-9._-]*$",
        "u",
      ),
    );
    const unchanged = matchOutputAction(
      line,
      new RegExp(
        `(?:^|[^A-Za-z0-9._-])no changes ${OUTPUT_APPLICATION_NAME}`
          + "[^A-Za-z0-9._-]*$",
        "iu",
      ),
    );

    if (created) {
      observed.push({ action: "created", applicationName: created });
    }
    if (modified) {
      observed.push({ action: "modified", applicationName: modified });
    }
    if (unchanged) {
      observed.push({ action: "unchanged", applicationName: unchanged });
    }
  }

  if (observed.length !== expectedContainers.length) {
    throw invalidWranglerActions();
  }

  const actions = observed.map((action) => {
    const expected = expectedByApplication.get(action.applicationName);
    if (!expected) {
      throw invalidWranglerActions();
    }
    return {
      ...action,
      className: expected.className,
    };
  });
  assertUniqueRenderedContainers(actions, invalidWranglerActions);
  return actions.sort(compareByApplicationName);
}

export function parseWranglerWorkerVersionId(output: string): string {
  const versionIds = stripAnsi(output)
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => /^Current Version ID:\s*([^\s]+)\s*$/u.exec(line.trim())?.[1] ?? null)
    .filter((value): value is string => value !== null);

  if (versionIds.length !== 1 || !isConfiguredSingleLine(versionIds[0] ?? "")) {
    throw new TypeError("Wrangler deploy output did not report exactly one Worker version.");
  }
  return versionIds[0];
}

export async function readCloudflareContainerApplicationIdentities(
  expectedContainers: readonly RenderedContainerIdentity[],
  listApplications: ListCloudflareContainerApplications,
  phase: ContainerApplicationReadPhase,
): Promise<CloudflareContainerApplicationIdentity[]> {
  assertUniqueRenderedContainers(expectedContainers, invalidProviderState);
  const identities: CloudflareContainerApplicationIdentity[] = [];

  for (const container of sortRenderedContainers(expectedContainers)) {
    let response: unknown;
    try {
      response = await listApplications(container.applicationName);
    } catch {
      throw invalidProviderState();
    }

    if (!Array.isArray(response)) {
      throw invalidProviderState();
    }

    const applications = response.map(parseProviderIdentity);
    if (phase === "before" && applications.length === 0) {
      continue;
    }
    if (applications.length !== 1
      || applications[0]?.applicationName !== container.applicationName) {
      throw invalidProviderState();
    }

    identities.push(applications[0]);
  }

  assertUniqueProviderIdentities(identities, invalidProviderState);
  return identities.sort(compareByApplicationName);
}

export function createCloudflareContainerApplicationLister(input: {
  accountId: string;
  apiToken: string;
  fetchImpl?: CloudflareContainerFetch;
}): ListCloudflareContainerApplications {
  if (!isConfiguredSingleLine(input.accountId) || !isConfiguredSingleLine(input.apiToken)) {
    throw invalidProviderState();
  }
  const fetchImpl = input.fetchImpl ?? defaultCloudflareFetch;

  return async (applicationName) => {
    if (!APPLICATION_NAME_PATTERN.test(applicationName)) {
      throw invalidProviderState();
    }

    const url = new URL(
      `${CLOUDFLARE_API_BASE_URL}/accounts/${encodeURIComponent(input.accountId)}`
        + "/containers/applications",
    );
    url.searchParams.set("name", applicationName);

    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.apiToken}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(CLOUDFLARE_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw invalidProviderState();
      }
      return readExhaustiveCloudflareResult(await response.json());
    } catch {
      throw invalidProviderState();
    }
  };
}

export function buildContainerReleaseEntries(input: {
  actions: readonly WranglerContainerAction[];
  after: readonly CloudflareContainerApplicationIdentity[];
  before: readonly CloudflareContainerApplicationIdentity[];
}): ContainerReleaseEntry[] {
  assertUniqueRenderedContainers(input.actions, invalidReleaseTransition);
  const beforeByApplication = indexProviderIdentities(input.before);
  const afterByApplication = indexProviderIdentities(input.after);
  const expectedNames = new Set(input.actions.map((action) => action.applicationName));

  if (afterByApplication.size !== expectedNames.size) {
    throw invalidReleaseTransition();
  }
  for (const applicationName of beforeByApplication.keys()) {
    if (!expectedNames.has(applicationName)) {
      throw invalidReleaseTransition();
    }
  }

  return [...input.actions]
    .sort(compareByClassNameThenApplicationName)
    .map((action) => {
      const before = beforeByApplication.get(action.applicationName);
      const after = afterByApplication.get(action.applicationName);
      if (!after) {
        throw invalidReleaseTransition();
      }

      let disposition: ContainerReleaseEntry["disposition"];
      switch (action.action) {
        case "created":
          if (before || after.version !== 1) {
            throw invalidReleaseTransition();
          }
          disposition = "created";
          break;
        case "modified":
          if (!before
            || before.applicationId !== after.applicationId
            || after.version !== before.version + 1) {
            throw invalidReleaseTransition();
          }
          disposition = "updated";
          break;
        case "unchanged":
          if (!before
            || before.applicationId !== after.applicationId
            || before.version !== after.version
            || before.image !== after.image) {
            throw invalidReleaseTransition();
          }
          disposition = "unchanged";
          break;
      }

      return {
        applicationName: action.applicationName,
        className: action.className,
        disposition,
        imageSha256: createHash("sha256").update(after.image).digest("hex"),
        version: after.version,
      };
    });
}

function readExhaustiveCloudflareResult(value: unknown): readonly unknown[] {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.result)) {
    throw invalidProviderState();
  }

  const resultInfo = value.result_info;
  if (resultInfo === undefined) {
    return value.result;
  }
  if (!isRecord(resultInfo)) {
    throw invalidProviderState();
  }

  const nextPageToken = resultInfo.next_page_token;
  if (nextPageToken !== undefined
    && nextPageToken !== null
    && (typeof nextPageToken !== "string" || nextPageToken.length > 0)) {
    throw invalidProviderState();
  }
  const totalCount = resultInfo.total_count;
  if (totalCount !== undefined
    && (typeof totalCount !== "number"
      || !Number.isSafeInteger(totalCount)
      || totalCount !== value.result.length)) {
    throw invalidProviderState();
  }
  return value.result;
}

function parseProviderIdentity(value: unknown): CloudflareContainerApplicationIdentity {
  if (!isRecord(value) || !isRecord(value.configuration)) {
    throw invalidProviderState();
  }

  const applicationId = readRequiredNonemptyString(value, "id", invalidProviderState);
  const applicationName = readRequiredNonemptyString(value, "name", invalidProviderState);
  const image = readRequiredNonemptyString(value.configuration, "image", invalidProviderState);
  const version = value.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version <= 0) {
    throw invalidProviderState();
  }

  return { applicationId, applicationName, image, version };
}

function indexProviderIdentities(
  identities: readonly CloudflareContainerApplicationIdentity[],
): Map<string, CloudflareContainerApplicationIdentity> {
  const indexed = new Map<string, CloudflareContainerApplicationIdentity>();
  for (const identity of identities) {
    if (typeof identity.applicationName !== "string"
      || !APPLICATION_NAME_PATTERN.test(identity.applicationName)
      || typeof identity.applicationId !== "string"
      || !isConfiguredSingleLine(identity.applicationId)
      || typeof identity.image !== "string"
      || !isConfiguredSingleLine(identity.image)
      || typeof identity.version !== "number"
      || !Number.isSafeInteger(identity.version)
      || identity.version <= 0) {
      throw invalidReleaseTransition();
    }
    if (indexed.has(identity.applicationName)) {
      throw invalidReleaseTransition();
    }
    indexed.set(identity.applicationName, identity);
  }
  return indexed;
}

function assertUniqueProviderIdentities(
  identities: readonly CloudflareContainerApplicationIdentity[],
  createError: () => Error,
): void {
  const names = new Set<string>();
  for (const identity of identities) {
    if (names.has(identity.applicationName)) {
      throw createError();
    }
    names.add(identity.applicationName);
  }
}

function assertUniqueRenderedContainers(
  containers: readonly RenderedContainerIdentity[],
  createError: () => Error,
): void {
  if (containers.length === 0) {
    throw createError();
  }
  const applicationNames = new Set<string>();
  const classNames = new Set<string>();
  for (const container of containers) {
    if (!APPLICATION_NAME_PATTERN.test(container.applicationName)
      || !isConfiguredSingleLine(container.className)
      || applicationNames.has(container.applicationName)
      || classNames.has(container.className)) {
      throw createError();
    }
    applicationNames.add(container.applicationName);
    classNames.add(container.className);
  }
}

function readOptionalNonemptyString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && isConfiguredSingleLine(value) ? value : null;
}

function readRequiredNonemptyString(
  record: Record<string, unknown>,
  key: string,
  createError: () => Error,
): string {
  const value = readOptionalNonemptyString(record, key);
  if (!value) {
    throw createError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripAnsi(value: string): string {
  return value
    .replace(ANSI_OSC_SEQUENCE_PATTERN, "")
    .replace(ANSI_STRING_SEQUENCE_PATTERN, "")
    .replace(ANSI_CSI_SEQUENCE_PATTERN, "")
    .replace(ANSI_SINGLE_ESCAPE_PATTERN, "");
}

function matchOutputAction(line: string, pattern: RegExp): string | null {
  const match = pattern.exec(line.trim());
  return match?.[1] ?? null;
}

function sortRenderedContainers(
  containers: readonly RenderedContainerIdentity[],
): RenderedContainerIdentity[] {
  return [...containers].sort(compareByApplicationName);
}

function compareByApplicationName(
  left: { applicationName: string },
  right: { applicationName: string },
): number {
  return left.applicationName.localeCompare(right.applicationName);
}

function compareByClassNameThenApplicationName(
  left: { applicationName: string; className: string },
  right: { applicationName: string; className: string },
): number {
  return left.className.localeCompare(right.className)
    || left.applicationName.localeCompare(right.applicationName);
}

function isConfiguredSingleLine(value: string): boolean {
  return value.length > 0 && value.trim() === value && !/[\r\n]/u.test(value);
}

function invalidRenderedConfig(): TypeError {
  return new TypeError("Generated Wrangler config did not contain an exact container identity set.");
}

function invalidWranglerActions(): TypeError {
  return new TypeError(
    "Wrangler deploy output did not report exactly one action for every rendered container.",
  );
}

function invalidProviderState(): TypeError {
  return new TypeError("Cloudflare container application state was incomplete or malformed.");
}

function invalidReleaseTransition(): TypeError {
  return new TypeError("Container release evidence did not form an exact provider transition.");
}
