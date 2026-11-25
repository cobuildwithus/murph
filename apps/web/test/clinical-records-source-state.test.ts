import { describe, expect, it } from "vitest";
import { classifyClinicalSource } from "@/src/lib/clinical-records/source-state";
import { CLINICAL_RECORD_RUN_STATUSES } from "@/src/lib/clinical-records/client-contracts";

const counts = { createdCount: 2, retractedCount: 0, supersededCount: 0 };
const run = (status: string, outcomeCountsJson: unknown = counts) => ({
  status, completedAt: ["queued", "retrieving"].includes(status) ? null : new Date(), outcomeCountsJson,
});

describe("clinical source state", () => {
  const across = (state: string) => Array<string>(7).fill(state);
  const cases = {
    active: ["getting_records", "getting_records", "ready", "ready_partial", "sign_in_again", "could_not_add", "could_not_add"],
    disconnected: across("disconnected"), needs_reauth: across("sign_in_again"),
    error: ["could_not_add", "could_not_add", "could_not_add", "could_not_add", "sign_in_again", "could_not_add", "could_not_add"],
    unrecognized: across("could_not_add"),
  };
  for (const [connection, states] of Object.entries(cases)) {
    it.each(CLINICAL_RECORD_RUN_STATUSES.map((status, index) => [status, states[index]] as const))(
      `${connection} with %s gives %s`, (status, expected) => {
        expect(classifyClinicalSource(connection, run(status), null).state).toBe(expected);
      });
  }
  it.each(["active", "disconnected", "needs_reauth", "error"])("isolates an unknown run on %s", status => {
    expect(classifyClinicalSource(status, run("unknown"), null)).toMatchObject({ state: "could_not_add", unknownStatus: true });
  });
  it("distinguishes absent receipts, unavailable lab counts and recorded zero effects", () => {
    expect(classifyClinicalSource("active", run("complete", null), null)).toMatchObject({ state: "could_not_add", lastImport: null });
    const receipt = { ...counts, createdCount: 0 };
    expect(classifyClinicalSource("active", run("complete", receipt), null)).toMatchObject({
      state: "nothing_new", lastImport: { addedCount: 0, labResultCount: null },
    });
    for (const effect of ["supersededCount", "retractedCount"]) {
      expect(classifyClinicalSource("active", run("complete", { ...receipt, [effect]: 1 }), null).state).toBe("ready");
    }
    expect(classifyClinicalSource("needs_reauth", run("needs_reauth", null), null)).toMatchObject({
      state: "sign_in_again", actions: ["remove"], lastImport: null,
    });
    expect(classifyClinicalSource("active", run("partial"), "provider-search-incomplete").reason).toBe("limited_by_hospital");
    expect(classifyClinicalSource("active", run("retrieving", null), null).actions).toEqual(["remove"]);
    expect(classifyClinicalSource("disconnected", run("complete"), null, false).actions).toEqual([]);
  });
});
