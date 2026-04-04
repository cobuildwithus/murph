import { describe, expect, it } from "vitest";

import {
  hostedArtifactObjectKey,
  hostedBundleObjectKey,
  hostedDispatchPayloadObjectKey,
  hostedExecutionJournalObjectKey,
  hostedSideEffectJournalObjectKey,
  hostedUserEnvObjectKey,
} from "../src/storage-paths.js";

const rootKey = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

describe("hosted storage paths", () => {
  it("derives opaque user-scoped and transient object keys", async () => {
    const userId = "user_secret_123";
    const eventId = "event_secret_456";
    const effectId = "effect_secret_789";
    const sha256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const hash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    const artifactKey = await hostedArtifactObjectKey(rootKey, userId, sha256);
    const bundleKey = await hostedBundleObjectKey(rootKey, "vault", hash);
    const userEnvKey = await hostedUserEnvObjectKey(rootKey, userId);
    const journalKey = await hostedExecutionJournalObjectKey(rootKey, userId, eventId);
    const sideEffectKey = await hostedSideEffectJournalObjectKey(rootKey, userId, effectId);
    const dispatchPayloadKey = await hostedDispatchPayloadObjectKey(rootKey, userId, eventId);

    expect(artifactKey).toMatch(/^users\/artifacts\/[0-9a-f]{24}\/[0-9a-f]{48}\.artifact\.bin$/);
    expect(bundleKey).toMatch(/^bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/);
    expect(userEnvKey).toMatch(/^users\/env\/[0-9a-f]{24}\.json$/);
    expect(journalKey).toMatch(/^transient\/execution-journal\/[0-9a-f]{24}\/[0-9a-f]{40}\.json$/);
    expect(sideEffectKey).toMatch(/^transient\/side-effects\/[0-9a-f]{24}\/[0-9a-f]{40}\.json$/);
    expect(dispatchPayloadKey).toMatch(/^transient\/dispatch-payloads\/[0-9a-f]{24}\/[0-9a-f]{40}\.json$/);

    for (const key of [
      artifactKey,
      bundleKey,
      userEnvKey,
      journalKey,
      sideEffectKey,
      dispatchPayloadKey,
    ]) {
      expect(key).not.toContain(userId);
      expect(key).not.toContain(eventId);
      expect(key).not.toContain(effectId);
      expect(key).not.toContain(sha256);
      expect(key).not.toContain(hash);
    }
  });

  it("returns stable keys for the same inputs", async () => {
    const first = await hostedDispatchPayloadObjectKey(rootKey, "user_123", "event_123");
    const second = await hostedDispatchPayloadObjectKey(rootKey, "user_123", "event_123");

    expect(first).toBe(second);
  });
});
