import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

const processModuleUrl = new URL("../src/process.ts", import.meta.url).href;

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
