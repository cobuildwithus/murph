import { describe, expect, it } from "vitest";
import { summarizeDeviceImportHealth, type DeviceImportObservation } from "@/src/lib/hosted-runtime-progress/device-import-health";

const now = new Date("2026-08-10T16:00:00Z");
const minute = 60_000;
function row(minutesAgo: number, patch: Partial<DeviceImportObservation> = {}): DeviceImportObservation {
  return { subjectKey: "synthetic-subject", connectionKey: "a".repeat(64), attemptId: "attempt-a", at: new Date(+now - minutesAgo * minute),
    eventCode: "device-sync.pass_finished", pending: true, progressed: false,
    checkpointAccepted: false, restarted: false, cancelled: false, ...patch };
}
function checkpoint(minutesAgo: number, patch: Partial<DeviceImportObservation> = {}) {
  return row(minutesAgo, { eventCode: "checkpoint.snapshot_finished", connectionKey: null, pending: null, checkpointAccepted: true, ...patch });
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

  it("requires an overdue wake for a checkpointed queue but not for unsaved active work", () => {
    const rows = [row(20), checkpoint(19), row(10), checkpoint(9), row(1)];
    expect(health([...rows, checkpoint(0.5)], false).stalled.anomalous).toBe(false);
    expect(health(rows, false).stalled.anomalous).toBe(true);
    expect(health([...rows, checkpoint(0.5, { checkpointAccepted: false })], false).stalled.anomalous).toBe(true);
    expect(health([...rows, checkpoint(0.5, { attemptId: "other" })], false).stalled.anomalous).toBe(true);
    expect(health([...rows, checkpoint(0.5)], true).stalled.anomalous).toBe(true);
  });

  it("does not let a late checkpoint for an older attempt save the latest pass", () => {
    const rows = [row(20, { attemptId: "older" }), row(10, { attemptId: "latest" }),
      row(1, { attemptId: "latest" }), checkpoint(0.5, { attemptId: "older" })];
    expect(health(rows, false).stalled.anomalous).toBe(true);
    expect(health([...rows, checkpoint(0, { attemptId: "latest" })], false).stalled.anomalous).toBe(false);
  });

  it("keeps cycling and backlog signals when checkpointed work awaits its wake", () => {
    const rows = Array.from({ length: 13 }, (_, index) => 60 - index * 5)
      .flatMap(age => [row(age + 0.1, { restarted: true }), checkpoint(age)]);
    const result = health(rows, false);
    expect(result.stalled.anomalous).toBe(false);
    expect(result.cycling.anomalous).toBe(true);
    expect(result.backlog.anomalous).toBe(true);
  });

  it("keeps a stalled connection pending while another connection drains and checkpoints", () => {
    const stalled = Array.from({ length: 15 }, (_, index) => row(70 - index * 5));
    const draining = Array.from({ length: 14 }, (_, index) => {
      const age = 68 - index * 5;
      return [row(age, { connectionKey: "b".repeat(64), attemptId: "attempt-b", pending: false, progressed: true }),
        checkpoint(age - 1, { attemptId: "attempt-b" })];
    }).flat();
    for (const age of [55, 30, 0]) {
      const cutoff = new Date(+now - age * minute);
      const result = summarizeDeviceImportHealth({ now: cutoff,
        observations: [...stalled, ...draining].filter(observation => observation.at <= cutoff),
        dueSubjects: new Set(["synthetic-subject"]) });
      expect(result.stalled.affectedRuntimeCount).toBe(1);
    }
    const result = health([...stalled, ...draining]);
    expect(result.stalled.oldestBacklogMs).toBe(70 * minute);
    expect(result.backlog.affectedRuntimeCount).toBe(1);
    expect(health([...stalled, ...draining, row(0, { pending: false }), checkpoint(0)]).stalled.anomalous).toBe(false);
  });

  it("counts a runtime and its starts once when multiple connections are stalled", () => {
    const first = [19, 14, 9, 4].map(age => row(age, { restarted: true }));
    const second = [19, 14, 9, 4].map(age => row(age, { connectionKey: "b".repeat(64), attemptId: "attempt-b" }));
    const result = health([...first, ...second]);
    expect(result.stalled.affectedRuntimeCount).toBe(1);
    expect(result.cycling).toMatchObject({ affectedRuntimeCount: 1, restartCount: 4 });
  });

  it("shares a checkpoint only with the connections observed in that attempt", () => {
    const rows = [row(20), row(10), row(2, { connectionKey: "b".repeat(64), pending: false, progressed: true })];
    expect(health([...rows, checkpoint(1)]).stalled.affectedRuntimeCount).toBe(1);
    expect(health([...rows, row(0.5, { pending: false }), checkpoint(0)]).stalled.anomalous).toBe(false);
  });

  it("does not use legacy or unowned passes to credit progress or recover a connection", () => {
    const legacy = row(1, { connectionKey: null, pending: false, progressed: true });
    expect(health([row(20), row(10), legacy, checkpoint(0)]).stalled.anomalous).toBe(true);
    expect(health([row(20, { connectionKey: null }), checkpoint(0)]).stalled.anomalous).toBe(false);
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

  it("keeps a continuing backlog eligible until its evidence gap lapses", () => {
    // Ten-minute retry passes checked every five minutes must stay one
    // incident instead of clearing between passes and re-alerting.
    const passes = (latest: number) => Array.from({ length: 7 }, (_, index) => row(latest + index * 10));
    for (const latest of [0.5, 5, 10, 12, 15]) {
      expect(health(passes(latest), false).backlog.anomalous).toBe(true);
    }
    expect(health(passes(16), false).backlog.anomalous).toBe(false);
    const overdue = health(passes(16), true);
    expect(overdue.backlog.anomalous).toBe(false);
    expect(overdue.stalled.anomalous).toBe(true);
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
