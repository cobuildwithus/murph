import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createExperiment, initializeVault, VAULT_LAYOUT, walkVaultFiles } from "@murphai/core";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";
import { Cli } from "incur";
import { test } from "vitest";

import { registerExperimentCommands } from "../src/commands/experiment.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import {
  type InProcessCliJsonResult,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

const artifactFailureHint =
  "Stop protocol discovery, onboarding, planning, and starting a protocol until the packaged artifacts are restored or regenerated; then rerun the command. No protocol-backed run was created.";

function createExperimentSliceCli() {
  const cli = Cli.create("vault-cli", {
    description: "experiment artifact recovery test cli",
    version: "0.0.0-test",
  });
  cli.use(incurErrorBridge);
  registerExperimentCommands(cli, createIntegratedVaultServices());
  return cli;
}

function assertProtocolArtifactFailure(
  result: InProcessCliJsonResult,
  input: {
    code: "commons_protocol_artifact_invalid" | "commons_protocol_artifact_unavailable";
    privateValues: readonly string[];
  },
): void {
  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.ok, false);
  if (result.envelope.ok) {
    throw new Error("Expected Health Commons protocol artifact failure.");
  }
  assert.equal(result.envelope.error.code, input.code);
  assert.equal(result.envelope.error.retryable, false);
  assert.equal(result.envelope.error.stage, "protocol_run_specs");
  assert.equal(result.envelope.error.hint, artifactFailureHint);
  assert.equal("data" in result.envelope, false);
  const serialized = JSON.stringify(result.envelope);
  for (const value of input.privateValues) {
    assert.doesNotMatch(
      serialized,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  }
}

test.sequential(
  "protocol artifact failures stop experiment start, hydration, and activation without writes or private echoes",
  async () => {
    for (const category of ["unavailable", "invalid"] as const) {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-experiment-artifact-vault-"));
      const packageRoot = await mkdtemp(path.join(tmpdir(), "murph-experiment-artifact-package-"));
      const privateArtifactValue = `private-${category}-artifact-value`;
      const privateLookups = [
        `private-${category}-dry-run`,
        `private-${category}-real-start`,
        `private-${category}-hydrate`,
      ];
      const previousPackageRoot = process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;

      try {
        await initializeVault({ vaultRoot });
        const existing = await createExperiment({
          vaultRoot,
          slug: `artifact-${category}-planned`,
          title: "Artifact recovery planned experiment",
          startedOn: "2026-08-24",
          status: "planned",
          commonsProtocolRef: {
            key: "protocol_variant:artifact-recovery/example",
            pageRevisionId: `sha256:${"1".repeat(64)}`,
            runSpecRevisionId: `sha256:${"2".repeat(64)}`,
          },
          effectiveProtocolSnapshot: {
            doseSignature: "Existing saved protocol dose",
            effectiveSpecHash: `sha256:${"3".repeat(64)}`,
          },
        });
        const experimentPath = path.join(vaultRoot, existing.experiment.relativePath);
        const beforeDocument = await readFile(experimentPath, "utf8");
        const beforeExperimentPaths = await walkVaultFiles(
          vaultRoot,
          VAULT_LAYOUT.experimentsDirectory,
          { extension: ".md" },
        );

        if (category === "invalid") {
          await mkdir(path.join(packageRoot, "generated"), { recursive: true });
          await writeFile(
            path.join(packageRoot, "generated", "protocol-run-specs.json"),
            `${privateArtifactValue} {not-json}`,
            "utf8",
          );
        }
        process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = packageRoot;

        const commands = [
          [
            "experiment",
            "start",
            `artifact-${category}-dry-run`,
            "--from-protocol",
            privateLookups[0],
            "--intervention-start",
            "2026-08-25",
            "--dry-run",
            "--vault",
            vaultRoot,
          ],
          [
            "experiment",
            "start",
            `artifact-${category}-real-start`,
            "--from-protocol",
            privateLookups[1],
            "--intervention-start",
            "2026-08-25",
            "--vault",
            vaultRoot,
          ],
          [
            "experiment",
            "edit",
            existing.experiment.slug,
            "--protocol-key",
            privateLookups[2],
            "--hydrate-protocol-defaults",
            "--vault",
            vaultRoot,
          ],
          [
            "experiment",
            "edit",
            existing.experiment.slug,
            "--status",
            "active",
            "--vault",
            vaultRoot,
          ],
        ];

        for (const command of commands) {
          const result = await runInProcessJsonCli(
            createExperimentSliceCli(),
            command,
          );
          assertProtocolArtifactFailure(result, {
            code:
              category === "unavailable"
                ? "commons_protocol_artifact_unavailable"
                : "commons_protocol_artifact_invalid",
            privateValues: [
              packageRoot,
              privateArtifactValue,
              ...privateLookups,
            ],
          });
          assert.deepEqual(
            await walkVaultFiles(
              vaultRoot,
              VAULT_LAYOUT.experimentsDirectory,
              { extension: ".md" },
            ),
            beforeExperimentPaths,
          );
          assert.equal(await readFile(experimentPath, "utf8"), beforeDocument);
        }
      } finally {
        if (previousPackageRoot === undefined) {
          delete process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
        } else {
          process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = previousPackageRoot;
        }
        await rm(packageRoot, { force: true, recursive: true });
        await rm(vaultRoot, { force: true, recursive: true });
      }
    }
  },
);
