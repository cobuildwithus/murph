import { describe, expect, it } from "vitest";

import {
  parseHostedRunnerStatusResponse,
} from "../src/parsers/runtime-control.ts";

const baseStatus = {
  inFlight: false,
  mailboxLag: [],
  userId: "member_r2_cutover",
  workspace: null,
};

describe("hosted runner R2 cutover status", () => {
  it("preserves the bridge protocol and fixed-role phase for deployment drain checks", () => {
    expect(parseHostedRunnerStatusResponse({
      ...baseStatus,
      r2Cutover: {
        coexisting: true,
        phase: "destination_active",
        protocolVersion: "r2-oc-enam-v1",
      },
    }).r2Cutover).toEqual({
      coexisting: true,
      phase: "destination_active",
      protocolVersion: "r2-oc-enam-v1",
    });
  });

  it("remains backward-compatible with pre-bridge runner status", () => {
    expect(parseHostedRunnerStatusResponse(baseStatus).r2Cutover).toBeUndefined();
  });

  it("rejects an unknown cutover phase", () => {
    expect(() => parseHostedRunnerStatusResponse({
      ...baseStatus,
      r2Cutover: {
        coexisting: true,
        phase: "dual_write",
        protocolVersion: "r2-oc-enam-v1",
      },
    })).toThrow("r2Cutover.phase");
  });
});
