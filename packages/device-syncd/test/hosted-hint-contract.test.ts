import { describe, expect, it } from "vitest";

import {
  deviceSyncProviderManifests,
  normalizeConfiguredDeviceSyncJobInput,
  type DeviceSyncJobPayloadFieldKind,
} from "@murphai/device-syncd/config";
import { shapeHostedDeviceSyncJobHintPayload } from "@murphai/device-syncd/hosted-hints";
import { parseHostedExecutionDeviceSyncWakeHint } from "@murphai/device-syncd/hosted-runtime";

const CANONICAL_TIMESTAMP = "2026-04-02T00:00:00.000Z";

function sampleFieldValue(kind: DeviceSyncJobPayloadFieldKind) {
  switch (kind) {
    case "boolean": return false;
    case "number": return 0;
    // A canonical timestamp also satisfies transport refinements on string fields.
    case "string": return CANONICAL_TIMESTAMP;
    case "string[]": return ["synthetic-scope"];
  }
}

const jobContracts = deviceSyncProviderManifests.flatMap((manifest) =>
  Object.entries(manifest.jobs).map(([kind, definition]) => {
    if (!definition) {
      throw new Error(`Missing declared ${manifest.provider} ${kind} job definition.`);
    }
    const fields = Object.entries(definition.payload);
    const payload = Object.fromEntries(fields.map(([field, spec]) =>
      [field, sampleFieldValue(spec.kind)]
    ));
    const hostedFields = fields.filter(([, spec]) =>
      spec.includeInHostedHint && spec.kind !== "string[]"
    );
    return { provider: manifest.provider, kind, payload, hostedFields };
  })
);

describe("manifest-owned hosted hint transport contract", () => {
  it.each(jobContracts)("preserves $provider $kind jobs across producer and reader boundaries", ({
    provider, kind, payload, hostedFields,
  }) => {
    const job = normalizeConfiguredDeviceSyncJobInput(provider, { kind, payload }, "contract test");
    const shaped = shapeHostedDeviceSyncJobHintPayload(provider, job);
    const expected = Object.fromEntries(hostedFields.map(([field]) => [field, payload[field]]));
    const hint = { jobs: [{ kind, payload: shaped }] };

    // Compare against producer declarations as well as emitted data: silent field
    // dropping by either side must fail, even when both sides agree on the omission.
    expect(shaped).toEqual(expected);
    expect(parseHostedExecutionDeviceSyncWakeHint(JSON.parse(JSON.stringify(hint))))
      .toEqual({ jobs: [{ kind, payload: expected }] });
  });

  it.each(jobContracts)("rejects malformed emitted fields for $provider $kind", ({
    provider, kind, payload, hostedFields,
  }) => {
    const job = normalizeConfiguredDeviceSyncJobInput(provider, { kind, payload }, "contract test");
    const shaped = shapeHostedDeviceSyncJobHintPayload(provider, job);

    for (const [field, spec] of hostedFields) {
      const wrongPrimitive = spec.kind === "string" ? 17 : "wrong-type";
      for (const value of [wrongPrimitive, null, {}, []]) {
        expect(() => parseHostedExecutionDeviceSyncWakeHint(JSON.parse(JSON.stringify({
          jobs: [{ kind, payload: { ...shaped, [field]: value } }],
        }))), `${provider} ${kind} ${field} must reject ${JSON.stringify(value)}`)
          .toThrow(TypeError);
      }
      if (spec.kind === "number") {
        for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
          // Nonfinite values are invalid before serialization, and JSON turns
          // them into null, which the transport reader must also reject.
          const hint = { jobs: [{ kind, payload: { ...shaped, [field]: value } }] };
          expect(() => parseHostedExecutionDeviceSyncWakeHint(hint)).toThrow(TypeError);
          expect(() => parseHostedExecutionDeviceSyncWakeHint(JSON.parse(JSON.stringify(hint))))
            .toThrow(TypeError);
        }
      }
    }
  });

  it.each(["refreshToken", "accessToken", "undeclaredField", "constructor", "__proto__"])(
    "rejects undeclared field %s rather than preserving or silently dropping it",
    (field) => {
      const hint = { jobs: [{ kind: "resource", payload: { [field]: "synthetic-value" } }] };
      expect(() => parseHostedExecutionDeviceSyncWakeHint(JSON.parse(JSON.stringify(hint))))
        .toThrow(TypeError);
    },
  );

  it("preserves stricter timestamp validation after manifest string validation", () => {
    const job = normalizeConfiguredDeviceSyncJobInput("junction", {
      kind: "resource", payload: { occurredAt: "not-a-timestamp" },
    }, "contract test");
    const hint = {
      jobs: [{ kind: job.kind, payload: shapeHostedDeviceSyncJobHintPayload("junction", job) }],
    };
    expect(() => parseHostedExecutionDeviceSyncWakeHint(JSON.parse(JSON.stringify(hint))))
      .toThrow(/occurredAt must be an ISO timestamp/u);
  });
});
