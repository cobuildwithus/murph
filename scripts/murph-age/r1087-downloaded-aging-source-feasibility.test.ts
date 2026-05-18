import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  runR1087DownloadedAgingSourceFeasibility,
} from "./r1087-downloaded-aging-source-feasibility.ts";

describe("R1087 downloaded aging source feasibility", () => {
  it("keeps SEBAS blocked when only documentation is present while existing loops remain usable", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1087-"));
    const downloadsDir = path.join(tmp, "downloads");
    const outputDir = path.join(tmp, "out");
    await mkdir(downloadsDir, { recursive: true });
    await Promise.all([
      touch(downloadsDir, "03792-User_agreement.pdf.zip"),
      touch(downloadsDir, "ICPSR_04652-V8.zip"),
      touch(downloadsDir, "ICPSR_29282-V11.zip"),
      touch(downloadsDir, "ICPSR_36532-V4.zip"),
      touch(downloadsDir, "ICPSR_36901-V6.zip"),
      touch(downloadsDir, "ICPSR_37237-V6.zip"),
      touch(downloadsDir, "ICPSR_38024-V3.zip"),
      touch(downloadsDir, "ICPSR_26681-V3.zip"),
      touch(downloadsDir, "ICPSR_31263-V2.zip"),
      touch(downloadsDir, "ICPSR_35250-V2.zip"),
    ]);

    const { output } = await runR1087DownloadedAgingSourceFeasibility({
      createdAt: "2026-05-15T00:00:00.000Z",
      downloadsDir,
      outputDir,
    });

    expect(output.summary).toMatchObject({
      conclusion: "downloaded_sources_ready_for_existing_loops_sebas_blocked",
      nextLocalAction: "continue_existing_midus_creles_haalsi_mhas_aggregate_loops",
      sebasStatus: "blocked_data_archive_missing",
    });
    expect(output.artifactBoundary.rowParsingPerformedByR1087).toBe(false);
    expect(JSON.stringify(output)).not.toContain("ICPSR_");
    expect(JSON.stringify(output)).not.toContain(downloadsDir);
  });

  it("marks SEBAS metadata-card-ready when a data package is present", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "r1087-"));
    const downloadsDir = path.join(tmp, "downloads");
    await mkdir(downloadsDir, { recursive: true });
    await touch(downloadsDir, "sebas-data-package.zip");

    const { output } = await runR1087DownloadedAgingSourceFeasibility({ downloadsDir, outputDir: path.join(tmp, "out") });

    expect(output.summary.sebasStatus).toBe("ready_for_existing_aggregate_loop");
    expect(output.summary.nextLocalAction).toBe("continue_existing_midus_creles_haalsi_mhas_aggregate_loops");
  });
});

async function touch(dir: string, basename: string): Promise<void> {
  await writeFile(path.join(dir, basename), "");
}
