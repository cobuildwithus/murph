import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const defaultPreparedBundleDir = path.join(appDir, ".deploy", "runner-bundle");
const defaultBuiltSmokeDistDir = path.join(appDir, ".deploy", "smoke-dist");

type SyncSmokeRunnerBundleOptions = {
  builtSmokeDistDir?: string;
  preparedBundleDir?: string;
};

export async function syncSmokeRunnerBundle(
  options: SyncSmokeRunnerBundleOptions = {},
): Promise<void> {
  const preparedBundleDir = options.preparedBundleDir ?? defaultPreparedBundleDir;
  const builtSmokeDistDir = options.builtSmokeDistDir ?? defaultBuiltSmokeDistDir;
  const preparedDistDir = path.join(preparedBundleDir, "dist");

  await assertPreparedBundleExists({
    builtSmokeDistDir,
    preparedBundleDir,
  });
  await mkdir(preparedDistDir, { recursive: true });

  try {
    await cp(builtSmokeDistDir, preparedDistDir, {
      force: true,
      recursive: true,
    });
  } finally {
    await rm(builtSmokeDistDir, {
      force: true,
      recursive: true,
    });
  }
}

async function assertPreparedBundleExists(options: {
  builtSmokeDistDir: string;
  preparedBundleDir: string;
}): Promise<void> {
  const { builtSmokeDistDir, preparedBundleDir } = options;
  await access(path.join(preparedBundleDir, "package.json"));
  await access(path.join(preparedBundleDir, "node_modules"));
  await access(builtSmokeDistDir);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await syncSmokeRunnerBundle();
  console.log("Synced hosted runner smoke dist into the prepared runner bundle for local smoke.");
}
