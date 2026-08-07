import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const defaultProductionBundleDir = path.join(appDir, ".deploy", "runner-bundle");
const defaultSmokeBundleDir = path.join(appDir, ".deploy", "runner-smoke-bundle");
const defaultBuiltSmokeDistDir = path.join(appDir, ".deploy", "smoke-dist");
const defaultSmokeOnlyZodDir = path.resolve(
  appDir,
  "../../packages/contracts/node_modules/zod",
);

type SyncSmokeRunnerBundleOptions = {
  builtSmokeDistDir?: string;
  productionBundleDir?: string;
  smokeBundleDir?: string;
  smokeOnlyZodDir?: string;
};

export async function syncSmokeRunnerBundle(
  options: SyncSmokeRunnerBundleOptions = {},
): Promise<void> {
  const productionBundleDir = options.productionBundleDir ?? defaultProductionBundleDir;
  const smokeBundleDir = options.smokeBundleDir ?? defaultSmokeBundleDir;
  const builtSmokeDistDir = options.builtSmokeDistDir ?? defaultBuiltSmokeDistDir;
  const smokeOnlyZodDir = options.smokeOnlyZodDir ?? defaultSmokeOnlyZodDir;
  const smokeDistDir = path.join(smokeBundleDir, "dist");
  const smokeZodDir = path.join(smokeBundleDir, "node_modules", "zod");

  await assertSmokeInputsExist({
    builtSmokeDistDir,
    productionBundleDir,
    smokeOnlyZodDir,
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
    // The production image removes Zod after both emitted bundles inline it.
    // This smoke entrypoint is intentionally unbundled so its permission probe
    // can exercise source-shaped package boundaries; restore only that test
    // dependency in the isolated smoke bundle.
    await cp(smokeOnlyZodDir, smokeZodDir, {
      dereference: true,
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
  smokeOnlyZodDir: string;
}): Promise<void> {
  const { builtSmokeDistDir, productionBundleDir, smokeOnlyZodDir } = options;
  await access(path.join(productionBundleDir, "package.json"));
  await access(path.join(productionBundleDir, "node_modules"));
  await access(builtSmokeDistDir);
  await access(path.join(smokeOnlyZodDir, "package.json"));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await syncSmokeRunnerBundle();
  console.log("Synced hosted runner smoke dist into an isolated runner smoke bundle.");
}
