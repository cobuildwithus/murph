import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createIntegratedVaultServices } from "@murphai/vault-usecases";
import { Cli } from "incur";
import sharp from "sharp";
import { test } from "vitest";

import { registerExperimentCommands } from "../src/commands/experiment.js";
import { registerVaultCommands } from "../src/commands/vault.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import type { CliEnvelope } from "./cli-test-helpers.js";
import { requireData } from "./cli-test-helpers.js";

async function runProgressCardCli<TData>(
  args: readonly string[],
): Promise<CliEnvelope<TData>> {
  const cli = Cli.create("vault-cli", {
    description: "private experiment progress-card test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  const services = createIntegratedVaultServices();
  registerVaultCommands(cli, services);
  registerExperimentCommands(cli, services);

  const output: string[] = [];
  await cli.serve([...args, "--full-output", "--format", "json"], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk);
    },
  });
  return JSON.parse(output.join("").trim()) as CliEnvelope<TData>;
}

test("progress-card renders stable private vault media without a URL", async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-cli-private-progress-card-"),
  );
  try {
    requireData(await runProgressCardCli([
      "init",
      "--vault",
      vaultRoot,
      "--timezone",
      "America/Los_Angeles",
    ]));
    requireData(await runProgressCardCli([
      "experiment",
      "start",
      "private-progress-card",
      "--custom",
      "--no-public-protocol",
      "--title",
      "Private Progress Card",
      "--started-on",
      "2026-04-01",
      "--status",
      "active",
      "--intervention-start",
      "2026-04-08",
      "--intervention-days",
      "14",
      "--primary-biomarker-key",
      "biomarker:resting-heart-rate",
      "--vault",
      vaultRoot,
    ]));

    const args = [
      "experiment",
      "progress-card",
      "private-progress-card",
      "--as-of",
      "2026-04-10",
      "--vault",
      vaultRoot,
    ];
    const first = requireData(await runProgressCardCli<{
      media: {
        contentType: string;
        filename: string;
        kind: string;
        ref: string;
        sha256: string;
        sizeBytes: number;
      };
    }>(args));
    const second = requireData(await runProgressCardCli<typeof first>(args));

    assert.equal(first.media.kind, "vault_image");
    assert.equal(first.media.contentType, "image/png");
    assert.match(first.media.ref, /^raw\/captures\//u);
    assert.doesNotMatch(JSON.stringify(first), /https?:\/\//iu);
    assert.deepEqual(second.media, first.media);

    const bytes = await readFile(path.join(vaultRoot, first.media.ref));
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
    assert.equal(bytes.byteLength, first.media.sizeBytes);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      first.media.sha256,
    );
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 780);
  } finally {
    await rm(vaultRoot, { force: true, recursive: true });
  }
});
