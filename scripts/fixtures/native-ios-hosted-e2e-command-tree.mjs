import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [role, mode, pidFile] = process.argv.slice(2);
const fixturePath = fileURLToPath(import.meta.url);

if (role === "wrapper") {
  if (!pidFile || !["overflow", "success", "timeout"].includes(mode)) {
    throw new Error("Expected wrapper <overflow|success|timeout> <pid-file>.");
  }
  const grandchild = spawn(process.execPath, [fixturePath, "grandchild", mode], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  if (grandchild.pid === undefined) throw new Error("Grandchild did not start.");
  writeFileSync(pidFile, JSON.stringify({
    grandchild: grandchild.pid,
    wrapper: process.pid,
  }));
  grandchild.once("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  grandchild.once("exit", (code, signal) => {
    if (mode === "success" && code === 0 && signal === null) {
      process.stdout.write("wrapper:success\n");
      return;
    }
    process.exitCode = code ?? 1;
  });
  grandchild.send("start");
} else if (role === "grandchild") {
  process.once("message", () => {
    if (mode === "success") {
      process.stdout.write("grandchild:success\n");
      process.exit(0);
    }
    if (mode === "overflow") process.stdout.write("x".repeat(4_096));
    setInterval(() => undefined, 1_000);
  });
} else {
  throw new Error("Expected wrapper or grandchild role.");
}
