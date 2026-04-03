# importer adapter template

Before using this template:
1. add `ACME_DEVICE_PROVIDER_DESCRIPTOR` to `packages/importers/src/device-providers/provider-descriptors.ts`
2. export it through `packages/importers/src/device-providers/defaults.ts`
3. align the incoming snapshot shape with the `device-syncd` provider's `executeJob()` output

Copy the fenced code below into `packages/importers/src/device-providers/<provider>.ts` and replace the placeholder `Acme` and `acme` names.

Use this together with the `device-syncd` provider template so normalization matches the transport snapshot shape.

```ts
import { z } from "zod";

import {
  ACME_DEVICE_PROVIDER_DESCRIPTOR,
} from "./provider-descriptors.ts";
import {
  asArray,
  asPlainObject,
  createRawArtifact,
  makeNormalizedDeviceBatch,
  makeProviderExternalRef,
  pushObservationEvent,
  pushRawArtifact,
  pushSample,
  stringId,
  toIso,
} from "./shared-normalization.ts";

import type {
  DeviceProviderAdapter,
  NormalizedDeviceBatch,
} from "./types.ts";

const acmeSummarySchema = z.object({
  id: z.union([z.string(), z.number()]),
  day: z.string().optional(),
  recordedAt: z.union([z.string(), z.number(), z.date()]).optional(),
  steps: z.number().optional(),
  restingHeartRate: z.number().optional(),
  readinessScore: z.number().optional(),
}).catchall(z.unknown());

const acmeSnapshotSchema = z.object({
  accountId: z.union([z.string(), z.number()]).optional(),
  importedAt: z.union([z.string(), z.number(), z.date()]).optional(),
  profile: z.unknown().optional(),
  dailySummaries: z.array(acmeSummarySchema).optional(),
}).catchall(z.unknown());

export type AcmeSnapshotInput = z.infer<typeof acmeSnapshotSchema>;

function parseAcmeSnapshot(snapshot: unknown): AcmeSnapshotInput {
  return acmeSnapshotSchema.parse(snapshot);
}

function makeAcmeExternalRef(
  resourceType: string,
  resourceId: string,
  facet?: string,
) {
  return makeProviderExternalRef("acme", resourceType, resourceId, undefined, facet);
}

export function normalizeAcmeSnapshot(
  snapshot: AcmeSnapshotInput,
): NormalizedDeviceBatch {
  const request = asPlainObject(snapshot) ?? {};
  const importedAt = toIso(request.importedAt) ?? new Date().toISOString();
  const accountId = stringId(request.accountId);
  const events = [];
  const samples = [];
  const rawArtifacts = [];
  const dailySummaries = asArray(request.dailySummaries)
    .map((entry) => asPlainObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));

  pushRawArtifact(
    rawArtifacts,
    createRawArtifact("profile", "profile.json", request.profile),
  );

  for (const summary of dailySummaries) {
    const summaryId = stringId(summary.id) ?? `daily-${rawArtifacts.length + 1}`;
    const dayKey = typeof summary.day === "string" ? summary.day : undefined;
    const recordedAt = toIso(summary.recordedAt) ?? importedAt;
    const rawArtifactRole = `daily-summary:${summaryId}`;

    pushRawArtifact(
      rawArtifacts,
      createRawArtifact(rawArtifactRole, `daily-summary-${summaryId}.json`, summary),
    );

    pushObservationEvent(events, {
      metric: "daily-steps",
      value: summary.steps,
      unit: "count",
      occurredAt: recordedAt,
      recordedAt,
      dayKey,
      title: "Acme daily steps",
      rawArtifactRoles: [rawArtifactRole],
      externalRef: makeAcmeExternalRef("daily-summary", summaryId, "steps"),
    });

    pushObservationEvent(events, {
      metric: "resting-heart-rate",
      value: summary.restingHeartRate,
      unit: "bpm",
      occurredAt: recordedAt,
      recordedAt,
      dayKey,
      title: "Acme resting heart rate",
      rawArtifactRoles: [rawArtifactRole],
      externalRef: makeAcmeExternalRef("daily-summary", summaryId, "resting-heart-rate"),
    });

    pushObservationEvent(events, {
      metric: "readiness-score",
      value: summary.readinessScore,
      unit: "score",
      occurredAt: recordedAt,
      recordedAt,
      dayKey,
      title: "Acme readiness score",
      rawArtifactRoles: [rawArtifactRole],
      externalRef: makeAcmeExternalRef("daily-summary", summaryId, "readiness-score"),
    });

    pushSample(samples, {
      stream: "steps",
      value: summary.steps,
      unit: "count",
      recordedAt,
      dayKey,
      externalRef: makeAcmeExternalRef("daily-summary", summaryId, "steps-sample"),
    });
  }

  return makeNormalizedDeviceBatch({
    provider: "acme",
    accountId,
    importedAt,
    events,
    samples,
    rawArtifacts,
    provenance: {
      importedSections: {
        profile: Boolean(request.profile),
        dailySummaries: dailySummaries.length,
      },
    },
  });
}

export const acmeProviderAdapter: DeviceProviderAdapter<AcmeSnapshotInput> = {
  ...ACME_DEVICE_PROVIDER_DESCRIPTOR,
  parseSnapshot: parseAcmeSnapshot,
  normalizeSnapshot: normalizeAcmeSnapshot,
};
```

## After copying the template

Do not stop at the adapter file. Wire the provider into:
- `packages/importers/src/device-providers/defaults.ts`
- `packages/importers/src/device-providers/index.ts`
- `packages/importers/test/provider-descriptors.test.ts` when it should be a built-in first-class provider
- any provider-specific importer tests
- the compatibility matrix when the provider introduces a new family or naming surface

Keep the normalization conservative:
- retain useful raw artifacts
- reuse existing canonical names before creating new ones
- do not manufacture precision the upstream provider never supplied
- keep the adapter on the shared descriptor instead of carrying a second metadata surface
