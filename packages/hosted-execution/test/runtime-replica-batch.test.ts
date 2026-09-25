import { describe, expect, it } from "vitest";
import { buildHostedRuntimeReplicaBatchProtocolProbe, parseHostedRuntimeReplicaPutCommand } from "../src/runtime-resources.ts";

describe("replica receipt batches", () => {
  const { admission, settlement } = buildHostedRuntimeReplicaBatchProtocolProbe();
  it("accepts the complete physical family and exact settlement subset", () => {
    expect(parseHostedRuntimeReplicaPutCommand(admission)).toMatchObject({ operation: "admit_batch", uploads: expect.any(Array) });
    expect(parseHostedRuntimeReplicaPutCommand(settlement)).toEqual(settlement);
    expect(parseHostedRuntimeReplicaPutCommand({ ...settlement, writeIds: settlement.writeIds.slice(1) })).toMatchObject({ writeIds: expect.any(Array) });
  });
  it("keeps deployed single-object producers compatible", () => {
    const command = { operation: "admit", attemptId: "synthetic-attempt", generation: "1", objectKey: "root", writeId: "write" };
    expect(parseHostedRuntimeReplicaPutCommand(command)).toEqual(command);
    expect(parseHostedRuntimeReplicaPutCommand({ operation: "release", writeId: "write" })).toEqual({ operation: "release", writeId: "write" });
  });
  it.each([{ uploads: [] }, { uploads: [...admission.uploads, { writeId: "extra", objectKey: "extra", uploadId: "extra" }] }])("rejects empty and oversized admissions", ({ uploads }) => {
    expect(() => parseHostedRuntimeReplicaPutCommand({ ...admission, uploads })).toThrow("between 1 and 36");
  });
  it.each(["writeId", "objectKey"] as const)("rejects duplicate %s", field => {
    const uploads = admission.uploads.map((upload, index) => index === 1 ? { ...upload, [field]: admission.uploads[0]![field] } : upload);
    expect(() => parseHostedRuntimeReplicaPutCommand({ ...admission, uploads })).toThrow("duplicate");
  });
  it("rejects oversized identities and repeated settlement identities", () => {
    expect(() => parseHostedRuntimeReplicaPutCommand({ ...admission, uploads: [{ ...admission.uploads[0], uploadId: "x".repeat(1025) }] })).toThrow("too long");
    expect(() => parseHostedRuntimeReplicaPutCommand({ ...settlement, writeIds: ["same", "same"] })).toThrow("duplicate");
  });
});
