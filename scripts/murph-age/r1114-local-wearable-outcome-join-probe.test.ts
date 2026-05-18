import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";
import {
  R1114_LOCAL_WEARABLE_OUTCOME_JOIN_PROBE_SCHEMA_VERSION,
  runR1114LocalWearableOutcomeJoinProbe,
} from "./r1114-local-wearable-outcome-join-probe.ts";

describe("R1114 local wearable outcome join probe", () => {
  it("reports not configured when no scan roots are provided", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-empty-"));
    try {
      const { output } = await runR1114LocalWearableOutcomeJoinProbe({
        createdAt: "2026-05-15T00:00:00.000Z",
        outputDir: path.join(tmp, "out"),
        scanRoots: [],
      });

      expect(output.schemaVersion).toBe(R1114_LOCAL_WEARABLE_OUTCOME_JOIN_PROBE_SCHEMA_VERSION);
      expect(output.summary).toMatchObject({
        conclusion: "local_header_join_probe_not_configured",
        nextAction: "configure_local_join_scan_roots",
        productDisplayAuthorized: false,
        reviewGptRequiredNow: false,
        rowParsingPerformedByR1114: false,
        scanRootsConfigured: false,
      });
      expect(findForbiddenAggregateEgress(output)).toEqual([]);
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("detects a potential person-level join from headers without storing header values", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-join-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "wearable.csv"), "participant_id,date,steps,sleep_minutes\np1,2026-01-01,1,1\n");
      await writeFile(path.join(scanRoot, "outcome.csv"), "participant_id,event_date,diagnosis_event\np1,2026-01-01,0\n");

      const { output } = await runR1114LocalWearableOutcomeJoinProbe({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary).toMatchObject({
        conclusion: "local_wearable_outcome_headers_potential_person_join",
        nextAction: "map_allowed_local_headers_privately_before_receipt",
        scanRootsConfigured: true,
      });
      expect(output.joinProbe.roots[0]).toMatchObject({
        familyJoinKeyCoverage: {
          outcome_label_like: {
            id_like: "1",
          },
          wearable_health_like: {
            id_like: "1",
          },
        },
        headerFamilyCountBands: {
          outcome_label_like: "1",
          unknown: "0",
          wearable_health_like: "1",
        },
        joinKeyCoverage: {
          date_like: "2-9",
          id_like: "2-9",
        },
        kind: "local_user_downloads",
      });
      const encoded = JSON.stringify(output);
      expect(encoded).not.toContain(scanRoot);
      expect(encoded).not.toContain("participant_id");
      expect(encoded).not.toContain("steps");
      expect(encoded).not.toContain("diagnosis_event");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat unrelated ID-like headers as a wearable/outcome join", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-unrelated-id-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "wearable.csv"), "date,steps,sleep_minutes\n2026-01-01,1,1\n");
      await writeFile(path.join(scanRoot, "outcome.csv"), "event_date,diagnosis_event\n2026-01-01,0\n");
      await writeFile(path.join(scanRoot, "other.csv"), "participant_id,notes\np1,note\n");

      const { output } = await runR1114LocalWearableOutcomeJoinProbe({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("local_wearable_outcome_headers_need_human_mapping");
      expect(output.joinProbe.roots[0]?.familyJoinKeyCoverage).toMatchObject({
        outcome_label_like: {
          id_like: "0",
        },
        wearable_health_like: {
          id_like: "0",
        },
      });
      expect(output.joinProbe.roots[0]?.joinKeyCoverage.id_like).toBe("1");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("does not treat generic device and event ids as person join keys", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-generic-id-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "wearable.csv"), "device_id,date,steps,sleep_minutes\nw1,2026-01-01,1,1\n");
      await writeFile(path.join(scanRoot, "outcome.csv"), "event_id,event_date,diagnosis_event\nDx1,2026-01-01,0\n");

      const { output } = await runR1114LocalWearableOutcomeJoinProbe({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("local_wearable_outcome_headers_need_human_mapping");
      expect(output.joinProbe.roots[0]?.familyJoinKeyCoverage).toMatchObject({
        outcome_label_like: {
          id_like: "0",
        },
        wearable_health_like: {
          id_like: "0",
        },
      });
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("distinguishes headers that need human mapping", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-human-map-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "wearable.csv"), "date,steps,sleep_minutes\n2026-01-01,1,1\n");
      await writeFile(path.join(scanRoot, "outcome.csv"), "event_date,diagnosis_event\n2026-01-01,0\n");

      const { output } = await runR1114LocalWearableOutcomeJoinProbe({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("local_wearable_outcome_headers_need_human_mapping");
      expect(output.summary.nextAction).toBe("map_allowed_local_headers_privately_before_receipt");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("reports not joinable when only wearable headers are present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-no-outcome-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "wearable.csv"), "person_id,date,heart_rate,steps\np1,2026-01-01,60,1\n");

      const { output } = await runR1114LocalWearableOutcomeJoinProbe({
        outputDir: path.join(tmp, "out"),
        scanRoots: [scanRoot],
      });

      expect(output.summary.conclusion).toBe("local_wearable_outcome_headers_not_joinable");
      expect(output.summary.nextAction).toBe("ignore_local_wearable_file_until_outcome_join_exists");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });

  it("prints a compact pathless CLI summary", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1114-cli-"));
    try {
      const scanRoot = path.join(tmp, "downloads");
      await mkdir(scanRoot, { recursive: true });
      await writeFile(path.join(scanRoot, "wearable.csv"), "person_id,date,steps\np1,2026-01-01,1\n");
      await writeFile(path.join(scanRoot, "outcome.csv"), "person_id,event_date,mortality_event\np1,2026-01-01,0\n");

      const stdout = execFileSync("pnpm", [
        "exec",
        "tsx",
        path.join(process.cwd(), "scripts/murph-age/r1114-local-wearable-outcome-join-probe.ts"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          MURPH_AGE_LOCAL_JOIN_SCAN_ROOTS: scanRoot,
          MURPH_AGE_RESEARCH_OUTPUT_DIR: path.join(tmp, "out"),
        },
      });

      const summary = JSON.parse(stdout) as {
        conclusion: string;
        productDisplayAuthorized: boolean;
        scanRootsConfigured: boolean;
      };
      expect(summary).toMatchObject({
        conclusion: "local_wearable_outcome_headers_potential_person_join",
        productDisplayAuthorized: false,
        scanRootsConfigured: true,
      });
      expect(stdout).not.toContain(tmp);
      expect(stdout).not.toContain("person_id");
      expect(stdout).not.toContain("steps");
    } finally {
      await rm(tmp, { force: true, recursive: true });
    }
  });
});
