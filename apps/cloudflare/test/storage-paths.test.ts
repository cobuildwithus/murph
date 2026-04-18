import { describe, expect, it } from "vitest";

import {
  hostedArtifactObjectKey,
  hostedBundleObjectKey,
  hostedExecutionJournalObjectKey,
  hostedSideEffectRecordKey,
  hostedRunnerSecretsObjectKey,
} from "../src/storage-paths.js";
import { expectOpaqueStrings } from "./object-key-assertions.js";

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
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey(rootKey, userId);
    const journalKey = await hostedExecutionJournalObjectKey(rootKey, userId, eventId);
    const sideEffectKey = await hostedSideEffectRecordKey(rootKey, userId, effectId);

    expect(artifactKey).toMatch(/^users\/artifacts\/[0-9a-f]{24}\/[0-9a-f]{48}\.artifact\.bin$/);
    expect(bundleKey).toMatch(/^bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/);
    expect(runnerSecretsKey).toMatch(/^users\/runner-secrets\/[0-9a-f]{24}\.json$/);
    expect(journalKey).toMatch(/^transient\/execution-journal\/[0-9a-f]{24}\/[0-9a-f]{40}\.json$/);
    expect(sideEffectKey).toMatch(/^transient\/side-effects\/[0-9a-f]{24}\/[0-9a-f]{40}\.json$/);

    expectOpaqueStrings(
      [artifactKey, bundleKey, runnerSecretsKey, journalKey, sideEffectKey],
      [userId, eventId, effectId, sha256, hash],
    );
  });
});
