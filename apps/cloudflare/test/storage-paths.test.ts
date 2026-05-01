import { describe, expect, it } from "vitest";

import {
  hostedArtifactObjectKey,
  hostedBundleObjectKey,
  hostedRunnerSecretsObjectKey,
} from "../src/storage-paths.js";
import { expectOpaqueStrings } from "./object-key-assertions.js";

describe("hosted storage paths", () => {
  it("derives opaque user-scoped and transient object keys independently from encryption roots", async () => {
    const userId = "user_secret_123";
    const sha256 = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const hash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    const artifactKey = await hostedArtifactObjectKey({ sha256, userId });
    const bundleKey = await hostedBundleObjectKey({ hash, kind: "vault", userId });
    const runnerSecretsKey = await hostedRunnerSecretsObjectKey({ userId });

    expect(artifactKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/artifacts\/[0-9a-f]{48}\.artifact\.bin$/);
    expect(bundleKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/bundles\/vault\/[0-9a-f]{48}\.bundle\.json$/);
    expect(runnerSecretsKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/runner-secrets\.json$/);

    expectOpaqueStrings(
      [artifactKey, bundleKey, runnerSecretsKey],
      [userId, sha256, hash],
    );
  });
});
