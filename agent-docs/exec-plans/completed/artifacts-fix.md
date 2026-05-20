# Hosted Workspace Snapshot Direct-R2 Hard Cut

## Goal

Production v2 hosted workspace snapshots use one upload strategy:

```text
direct-r2-presigned-put
```

No normal fallback exists:

- no streaming Worker snapshot upload route
- no Worker request-body cap
- no 96 MiB snapshot cap
- no multipart upload state machine
- no artifact sidecars for v2 snapshot contents
- no `hosted-bundle.v1` producer

Legacy bundle/artifact refs remain restoreable during migration only.

## Architecture

`idle_shutdown` is the only v2 snapshot producer.

Flow:

```text
idle_shutdown
  -> Worker/DO validates lease/write fence
  -> Worker/DO creates snapshotId + objectKey
  -> Worker/DO creates short-lived upload session
  -> Worker/DO generates one-time data key, wrapped key, IV, and presigned R2 PUT URL
  -> container tar/compress/encrypts durable root locally
  -> container PUTs encrypted file directly to R2
  -> container calls complete with metadata
  -> Worker/DO verifies upload session + R2 object exists/size
  -> runtime checkpoint callback CASes HostedWorkspace.snapshotRef
```

Worker routes carry JSON only:

```text
POST /workspace-snapshots/start
POST /workspace-snapshots/:snapshotId/complete
POST /workspace-snapshots/:snapshotId/data-key/unwrap
GET  /workspace-snapshots/:snapshotId
```

There is no:

```text
PUT /workspace-snapshots/:snapshotId
```

## Schema Constants

The exported snapshot literals are the only production v2 values:

```ts
HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA = "murph.hosted-workspace-snapshot.v2";
HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND = "direct-r2-presigned-put";
HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME =
  "murph.hosted-workspace-snapshot-single-object.v1";
```

Tests should use the exported constants with `satisfies` so literals do not widen.

## Caps

```ts
HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES = 128 * 1024 * 1024;
HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES = 4 * 1024 * 1024 * 1024;
```

Policy:

- `>= 128 MiB`: log warning and size diagnostics
- `>= 4 GiB`: fail before upload, keep the old snapshot ref, and do not silently fallback

Multipart stays deferred until production telemetry shows snapshots approaching the single-part guard.

## Storage Namespace

V2 snapshot objects use a sibling user-scoped namespace:

```text
users/<namespace>/workspace-snapshots/<snapshotId>.snapshot.enc
```

Every attempt uses a fresh random `snapshotId`. Do not write to stable keys such as `latest.snapshot.enc`.

## Upload Session State

Upload sessions are short-lived DO metadata only:

```ts
type HostedWorkspaceSnapshotUploadSession = {
  schema: "murph.hosted-workspace-snapshot-upload.v1";
  userId: string;
  snapshotId: string;
  objectKey: string;
  attemptId: string;
  leaseGeneration: string;
  workspaceVersion: string;
  expectedWorkspaceVersion: string;
  createdAt: string;
  expiresAt: string;
  encryption: {
    scheme: typeof HOSTED_WORKSPACE_SNAPSHOT_ENCRYPTION_SCHEME;
    rootKeyId: string;
    wrappedDataKey: string;
    ivBase64: string;
    aad: HostedWorkspaceSnapshotV2Ref["encryption"]["aad"];
  };
};
```

Do not persist the presigned URL or plaintext data key.

## Required Proof

Keep the hosted-local direct-R2 proof as an architecture invariant:

```text
scenario: direct-r2-presigned-put
default payload: 150 MiB
```

Deploy validation should also include a staging/prod-shaped smoke that generates an actual R2 S3 presigned PUT URL, uploads a deterministic encrypted payload larger than 150 MiB from the container, HEADs the object through the Worker/R2 binding, verifies byte count through R2 plus the payload hash reported by the container, and deletes the object.

## Verification Targets

Covered or required before handoff:

- v2 parser/ref tests prove schema, upload kind, IV, snapshotId, and AAD invariants
- Worker outbound tests prove start/complete metadata routes and absence of Worker body upload route
- runtime bridge tests prove idle shutdown starts direct-R2 upload, direct PUTs encrypted bytes, completes checkpoint, and never calls artifact PUT for v2 snapshot contents
- deployment preflight tests require R2 presign account/bucket vars and access-key secrets
- hosted-local direct-R2 proof remains in the suite for the HTTPS interception bypass invariant

## State

Implementation is complete for this handoff. The production v2 path is start/complete metadata plus direct presigned PUT, with no Worker body upload route, no 96 MiB cap, no artifact sidecars, and legacy restore compatibility only.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
