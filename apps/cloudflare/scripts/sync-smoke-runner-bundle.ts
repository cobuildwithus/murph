import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const preparedBundleDir = path.join(appDir, ".deploy", "runner-bundle");
const builtSmokeDistDir = path.join(appDir, ".deploy", "smoke-dist");
const preparedDistDir = path.join(preparedBundleDir, "dist");

await assertPreparedBundleExists();
await mkdir(preparedDistDir, { recursive: true });
await cp(builtSmokeDistDir, preparedDistDir, {
  force: true,
  recursive: true,
});

console.log("Synced hosted runner smoke dist into the prepared runner bundle for local smoke.");

async function assertPreparedBundleExists(): Promise<void> {
  await access(path.join(preparedBundleDir, "package.json"));
  await access(path.join(preparedBundleDir, "node_modules"));
  await access(builtSmokeDistDir);
}
