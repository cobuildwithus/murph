/**
 * Image contract for the hosted-local MinIO sidecar (the local R2 stand-in).
 *
 * CI pulls this image on every hosted E2E run. Docker Hub rate-limits and times
 * out GitHub-hosted runners, which fails the run with a health-check timeout
 * that looks like a harness bug rather than a registry problem. Mirroring the
 * exact upstream release into GHCR removes that dependency, because GHCR pulls
 * from Actions use the workflow token and are not rate-limited.
 *
 * The mirror workflow publishes `MIRROR` from `UPSTREAM`; both live here so the
 * workflow and the harness cannot drift, which a guard test enforces.
 */

/** Exact upstream release the mirror is built from. */
export const HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE =
  "minio/minio:RELEASE.2025-09-07T16-13-09Z";

/** GHCR mirror of {@link HOSTED_LOCAL_MINIO_UPSTREAM_IMAGE}, same digest. */
export const HOSTED_LOCAL_MINIO_MIRROR_IMAGE =
  "ghcr.io/cobuildwithus/murph-hosted-local-minio:RELEASE.2025-09-07T16-13-09Z";
