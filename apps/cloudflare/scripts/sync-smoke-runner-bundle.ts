import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const defaultProductionBundleDir = path.join(appDir, ".deploy", "runner-bundle");
const defaultSmokeBundleDir = path.join(appDir, ".deploy", "runner-smoke-bundle");
const defaultBuiltSmokeDistDir = path.join(appDir, ".deploy", "smoke-dist");

type SyncSmokeRunnerBundleOptions = {
  builtSmokeDistDir?: string;
  productionBundleDir?: string;
  smokeBundleDir?: string;
};

export async function syncSmokeRunnerBundle(
  options: SyncSmokeRunnerBundleOptions = {},
): Promise<void> {
  const productionBundleDir = options.productionBundleDir ?? defaultProductionBundleDir;
  const smokeBundleDir = options.smokeBundleDir ?? defaultSmokeBundleDir;
  const builtSmokeDistDir = options.builtSmokeDistDir ?? defaultBuiltSmokeDistDir;
  const smokeDistDir = path.join(smokeBundleDir, "dist");

  await assertSmokeInputsExist({
    builtSmokeDistDir,
    productionBundleDir,
  });
  await rm(smokeBundleDir, {
    force: true,
    recursive: true,
  });

  try {
    await cp(productionBundleDir, smokeBundleDir, {
      force: true,
      recursive: true,
      verbatimSymlinks: true,
    });
    await mkdir(smokeDistDir, { recursive: true });
    await cp(builtSmokeDistDir, smokeDistDir, {
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

async function assertSmokeInputsExist(options: {
  builtSmokeDistDir: string;
  productionBundleDir: string;
}): Promise<void> {
  const { builtSmokeDistDir, productionBundleDir } = options;
  await access(path.join(productionBundleDir, "package.json"));
  await access(path.join(productionBundleDir, "node_modules"));
  await access(builtSmokeDistDir);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await syncSmokeRunnerBundle();
  console.log("Synced hosted runner smoke dist into an isolated runner smoke bundle.");
}
