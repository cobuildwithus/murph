import { describe, expect, it } from "vitest";
import { summarizeDeviceImportHealth, type DeviceImportObservation } from "@/src/lib/hosted-runtime-progress/device-import-health";

const now = new Date("2026-08-10T16:00:00Z");
const minute = 60_000;
function row(minutesAgo: number, patch: Partial<DeviceImportObservation> = {}): DeviceImportObservation {
  return { subjectKey: "synthetic-subject", attemptId: "attempt-a", at: new Date(+now - minutesAgo * minute),
    eventCode: "device-sync.pass_finished", pending: true, progressed: false,
    checkpointAccepted: false, restarted: false, cancelled: false, ...patch };
}
function checkpoint(minutesAgo: number, patch: Partial<DeviceImportObservation> = {}) {
  return row(minutesAgo, { eventCode: "checkpoint.snapshot_finished", pending: null, checkpointAccepted: true, ...patch });
}
function health(observations: DeviceImportObservation[], due = true) {
  return summarizeDeviceImportHealth({ now, observations,
    dueSubjects: new Set(due ? ["synthetic-subject"] : []) });
}

describe("device import progress and efficiency alerts", () => {
  it("detects 15 minutes without saved progress, including a silent due queue", () => {
    expect(health([row(15)]).stalled.anomalous).toBe(true);
    expect(health([row(14.99)]).stalled.anomalous).toBe(false);
    expect(health([row(30)]).stalled.anomalous).toBe(true);
  });

  it("does not credit work before its checkpoint or an unrelated checkpoint", () => {
    expect(health([row(20), row(10, { progressed: true }), checkpoint(9, { attemptId: "other" })])
      .stalled.anomalous).toBe(true);
    expect(health([row(20), row(10, { progressed: true }), checkpoint(9)])
      .stalled.anomalous).toBe(false);
    expect(health([row(20), row(10, { progressed: true }), checkpoint(9, { checkpointAccepted: false })])
      .stalled.anomalous).toBe(true);
  });

  it("does not let repeated unchanged checkpoints reset a stall", () => {
    expect(health([row(20), checkpoint(19), row(10), checkpoint(9), row(1), checkpoint(0.5)])
      .stalled.anomalous).toBe(true);
  });

  it("clears alerts when the queue is explicitly empty, preserving unknown observations", () => {
    expect(health([row(20), row(5), row(1, { pending: false }), checkpoint(0.5)]).stalled.anomalous).toBe(false);
    expect(health([row(20), row(5), row(1, { pending: false })]).stalled.anomalous).toBe(true);
    expect(health([row(20), row(5), row(1, { pending: false }), checkpoint(0.5, { attemptId: "other" })])
      .stalled.anomalous).toBe(true);
    expect(health([row(20), row(5), row(1, { pending: null })]).stalled.anomalous).toBe(true);
  });

  it("does not treat routine wake RPCs as runtime starts", () => {
    const wakes = Array.from({ length: 40 }, (_, index) => row(index / 3, {
      eventCode: "runner.processing_finished", pending: null,
    }));
    expect(health([row(19), row(5), ...wakes]).cycling.anomalous).toBe(false);
  });

  it("detects repeated starts or outer cancellation with little saved progress", () => {
    for (const field of ["restarted", "cancelled"] as const) {
      const rows = [19, 14, 9, 4].map(age => row(age, { [field]: true }));
      expect(health(rows).cycling.anomalous).toBe(true);
      expect(health(rows.slice(1)).cycling.anomalous).toBe(false);
    }
  });

  it("does not add starts and cancellations together to double-count one cycle", () => {
    expect(health([row(19, { restarted: true }), row(14, { cancelled: true }),
      row(9, { restarted: true }), row(4, { cancelled: true })]).cycling.anomalous).toBe(false);
  });

  it("does not page about productive cycles or count a repeated checkpoint twice", () => {
    const rows = [19, 14, 9, 4].map(age => row(age, { restarted: true }));
    expect(health([...rows, row(8, { progressed: true }), checkpoint(7),
      row(3, { progressed: true }), checkpoint(2)]).cycling.anomalous).toBe(false);
    expect(health([...rows, row(8, { progressed: true }), checkpoint(7), checkpoint(6)])
      .cycling.anomalous).toBe(true);
  });

  it("raises only a notice for an hour of healthy backlog drain", () => {
    const rows = Array.from({ length: 13 }, (_, index) => 60 - index * 5)
      .flatMap(age => [row(age + 0.1, { progressed: true }), checkpoint(age)]);
    const result = health(rows);
    expect(result.backlog.anomalous).toBe(true);
    expect(result.stalled.anomalous).toBe(false);
    expect(result.cycling.anomalous).toBe(false);
  });

  it("does not infer continuous uptime from sparse background checks", () => {
    expect(health([row(70), row(40), row(2)]).backlog.anomalous).toBe(false);
    expect(health([row(70), row(60)], false).backlog.anomalous).toBe(false);
  });

  it("isolates runtimes and exports aggregate counts without identifiers", () => {
    const result = health([row(20), row(10), row(1, { subjectKey: "healthy-subject", progressed: true }),
      checkpoint(0.5, { subjectKey: "healthy-subject" })]);
    expect(result.stalled.affectedRuntimeCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain("subject");
    expect(JSON.stringify(result)).not.toContain("attempt");
  });

  it("rejects malformed or future evidence instead of reporting healthy", () => {
    expect(() => health([row(-1)])).toThrow("chronology");
    expect(() => health([row(1, { at: new Date(NaN) })])).toThrow("chronology");
  });
});
