export type DeviceSyncAccountStatus =
  | "active"
  | "reauthorization_required"
  | "disconnected";

export type DeviceSyncAccountSetupPhase =
  | "pending_link"
  | "link_returned"
  | "source_confirmed"
  | "failed";

export type DeviceConnectionSourceStatus =
  | "connected"
  | "unavailable"
  | "error"
  | "disconnected";

export type DeviceConnectionSourceResourceAvailabilityValue =
  | string
  | number
  | boolean
  | null;

export type DeviceConnectionSourceResourceAvailabilitySummary = Record<
  string,
  DeviceConnectionSourceResourceAvailabilityValue
>;

export interface DeviceSyncProviderDescriptor {
  provider: string;
  connectionKind: "oauth2" | "external_link" | "sdk" | "manual" | "none";
  credentialPolicy: "oauth_tokens" | "provider_config" | "none";
  callbackPath: string | null;
  callbackUrl: string | null;
  webhookPath: string | null;
  webhookUrl: string | null;
  supportsWebhooks: boolean;
  defaultScopes: string[];
}

export interface DeviceSyncAccountRecord {
  id: string;
  provider: string;
  externalAccountId: string;
  displayName: string | null;
  status: DeviceSyncAccountStatus;
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
  scopes: string[];
  accessTokenExpiresAt?: string | null;
  metadata: Record<string, unknown>;
  connectedAt: string;
  lastWebhookAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextReconcileAt: string | null;
  sources?: DeviceSyncAccountSourceSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceSyncAccountSourceSummary {
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceCount: number;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** Monotonic exact-source connection lifecycle. */
  lifecycleEpoch?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastDataAt: string | null;
}

export interface DeviceConnectionSourceRecord {
  id: string;
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lifecycleEpoch?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last inbound payload that carried this source's data; null until one has. */
  lastDataAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDeviceConnectionSourceInput {
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName?: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  /** Omit to preserve the stored lifecycle; reconnect owners advance it explicitly. */
  lifecycleEpoch?: number;
  firstSeenAt?: string | null;
  /** Hosted hydration only: replace an exact source after Web advances its epoch. */
  replaceFirstSeenAt?: boolean;
  lastSeenAt: string;
  /** Omit to preserve the stored arrival signal; only hosted hydration sets it. */
  lastDataAt?: string | null;
}

export interface ListDeviceConnectionSourcesInput {
  connectionId: string;
  sourceProviderSlug?: string | null;
  status?: DeviceConnectionSourceStatus | null;
}

export interface ListDeviceSyncAccountsInput {
  provider?: string | null;
  sourceProviderSlug?: string | null;
}

export interface DeviceSyncCanonicalImportReceipt {
  importCompletedAt: string;
  resource: string;
  sourceProviderSlug: string;
}

export interface DeviceSyncJobRecord {
  id: string;
  provider: string;
  accountId: string;
  kind: string;
  payload: Record<string, unknown>;
  priority: number;
  availableAt: string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  status: "queued" | "running" | "succeeded" | "dead";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Exact canonical source/resource identities accepted while this job ran. */
  canonicalImportReceipts?: readonly DeviceSyncCanonicalImportReceipt[];
}
