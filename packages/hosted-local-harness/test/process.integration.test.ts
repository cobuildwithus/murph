import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const processModuleUrl = new URL("../src/process.ts", import.meta.url).href;
const e2eModuleUrl = new URL("../src/e2e.ts", import.meta.url).href;

describe("runForegroundCommand process ownership", () => {
  it.runIf(process.platform !== "win32")(
    "boundedly removes a detached group that ignores SIGTERM",
    async () => {
      const descendantSource = [
        'for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {',
        "  process.on(signal, () => {});",
        "}",
        "setInterval(() => {}, 1_000);",
      ].join("\n");
      const ownedLeaderSource = [
        'import { spawn } from "node:child_process";',
        'for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {',
        "  process.on(signal, () => {});",
        "}",
        'console.log(`OWNED:${process.pid}`);',
        "spawn(process.execPath, [\"--input-type=module\", \"-e\", "
          + `${JSON.stringify(descendantSource)}], { stdio: \"ignore\" });`,
        "setInterval(() => {}, 1_000);",
      ].join("\n");
      const wrapperSource = [
        `import { runForegroundCommand } from ${JSON.stringify(processModuleUrl)};`,
        "try {",
        "  await runForegroundCommand({",
        `    args: ["--input-type=module", "-e", ${JSON.stringify(ownedLeaderSource)}],`,
        "    command: process.execPath,",
        "    cwd: process.cwd(),",
        "    env: process.env,",
        '    label: "ignored-signal integration command",',
        "  });",
        '  console.log("RESULT:unexpected-success");',
        "  process.exitCode = 2;",
        "} catch (error) {",
        '  console.log(`RESULT:${error.name}:${error.commandSignal ?? "unknown"}`);',
        "}",
      ].join("\n");
      const wrapper = spawn(
        process.execPath,
        ["--input-type=module", "-e", wrapperSource],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      let ownedProcessGroupId: number | null = null;

      try {
        const ownedReady = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Timed out waiting for owned process group.")),
            5_000,
          );
          wrapper.stdout.setEncoding("utf8");
          wrapper.stdout.on("data", (chunk: string) => {
            output += chunk;
            const match = output.match(/OWNED:(\d+)/u);
            if (!match?.[1]) {
              return;
            }
            ownedProcessGroupId = Number(match[1]);
            clearTimeout(timeout);
            resolve();
          });
          wrapper.once("error", reject);
          wrapper.once("exit", (code, signal) => {
            reject(new Error(
              `Wrapper exited before starting its child (${code ?? "unknown"}/${signal ?? "none"}).`,
            ));
          });
        });
        await ownedReady;

        const interruptedAt = Date.now();
        process.kill(wrapper.pid!, "SIGTERM");
        const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Timed out waiting for bounded foreground cleanup.")),
              12_000,
            );
            wrapper.once("error", reject);
            wrapper.once("exit", (code, signal) => {
              clearTimeout(timeout);
              resolve({ code, signal });
            });
          },
        );

        expect(result).toEqual({ code: 0, signal: null });
        expect(Date.now() - interruptedAt).toBeLessThan(7_000);
        expect(output).toContain("RESULT:ForegroundCommandSignalError:SIGTERM");
        expect(() => process.kill(-ownedProcessGroupId!, 0)).toThrowError(
          expect.objectContaining({ code: "ESRCH" }),
        );
      } finally {
        if (wrapper.exitCode === null && wrapper.signalCode === null) {
          wrapper.kill("SIGKILL");
        }
        if (ownedProcessGroupId !== null) {
          try {
            process.kill(-ownedProcessGroupId, "SIGKILL");
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
              throw error;
            }
          }
        }
      }
    },
    20_000,
  );
});

describe("hosted-local E2E MinIO cleanup ownership", () => {
  it.runIf(process.platform !== "win32")(
    "exits after repeated parent signals while an exact-child cleanup command hangs",
    async () => {
      const tempDirectory = await mkdtemp(path.join(tmpdir(), "murph-minio-cleanup-bound-"));
      const dockerPath = path.join(tempDirectory, "docker");
      const pnpmPath = path.join(tempDirectory, "pnpm");
      const minioFifoPath = path.join(tempDirectory, "minio-fifo");
      const minioPidPath = path.join(tempDirectory, "minio-pid");
      const minioReadyPath = path.join(tempDirectory, "minio-ready");
      const minioStartedPath = path.join(tempDirectory, "minio-started");
      const pnpmLogPath = path.join(tempDirectory, "pnpm.log");
      const dockerSource = [
        "#!/bin/sh",
        'case "$*" in',
        "  *murph.hosted-local.role=r2-minio*)",
        '    if [ ! -e "$MURPH_TEST_MINIO_STARTED_FILE" ]; then',
        '      : > "$MURPH_TEST_MINIO_STARTED_FILE"',
        '      mkfifo "$MURPH_TEST_MINIO_FIFO"',
        '      printf "%s\\n" "$$" > "$MURPH_TEST_MINIO_PID_FILE"',
        '      : > "$MURPH_TEST_MINIO_READY_FILE"',
        "      trap '' HUP INT TERM",
        '      read -r _ < "$MURPH_TEST_MINIO_FIFO"',
        "    fi",
        "    ;;",
        "esac",
        "exit 0",
      ].join("\n");
      const pnpmSource = [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$MURPH_TEST_PNPM_LOG_FILE"',
        "exit 0",
      ].join("\n");
      await writeFile(dockerPath, dockerSource, { mode: 0o700 });
      await writeFile(pnpmPath, pnpmSource, { mode: 0o700 });
      await chmod(dockerPath, 0o700);
      await chmod(pnpmPath, 0o700);

      const wrapperSource = [
        `import { runHostedLocalE2eSuite } from ${JSON.stringify(e2eModuleUrl)};`,
        "const result = await runHostedLocalE2eSuite({",
        "  env: process.env,",
        "  prepareRunnerBundle: false,",
        '  scenario: "checkpoint-baseline",',
        "});",
        'console.log(`RESULT:${result.terminationSignal ?? "none"}`);',
      ].join("\n");
      const wrapper = spawn(
        process.execPath,
        ["--input-type=module", "-e", wrapperSource],
        {
          env: {
            ...process.env,
            MURPH_TEST_MINIO_FIFO: minioFifoPath,
            MURPH_TEST_MINIO_PID_FILE: minioPidPath,
            MURPH_TEST_MINIO_READY_FILE: minioReadyPath,
            MURPH_TEST_MINIO_STARTED_FILE: minioStartedPath,
            MURPH_TEST_PNPM_LOG_FILE: pnpmLogPath,
            PATH: `${tempDirectory}:${process.env.PATH ?? ""}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      wrapper.stdout.setEncoding("utf8");
      wrapper.stdout.on("data", (chunk: string) => {
        output += chunk;
      });

      try {
        await waitForFile(minioReadyPath, 5_000);
        const interruptedAt = Date.now();
        wrapper.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 50));
        wrapper.kill("SIGTERM");
        const result = await waitForChildExit(wrapper, 15_000);

        expect(result).toEqual({ code: 143, signal: null });
        expect(Date.now() - interruptedAt).toBeLessThan(12_000);
        expect(output).toContain("RESULT:SIGTERM");
        await expect(readFile(pnpmLogPath, "utf8")).resolves.not.toContain("vitest");
      } finally {
        if (wrapper.exitCode === null && wrapper.signalCode === null) {
          wrapper.kill("SIGKILL");
        }
        try {
          const minioPid = Number((await readFile(minioPidPath, "utf8")).trim());
          if (Number.isSafeInteger(minioPid) && minioPid > 0) {
            try {
              process.kill(minioPid, "SIGKILL");
            } catch (error) {
              if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
                throw error;
              }
            }
          }
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
        }
        await rm(tempDirectory, { force: true, recursive: true });
      }
    },
    20_000,
  );
});

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}.`);
}

async function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for bounded MinIO cleanup.")),
      timeoutMs,
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}
