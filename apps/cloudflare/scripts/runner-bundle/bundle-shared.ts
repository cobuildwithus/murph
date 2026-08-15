import path from "node:path";

import type { Metafile } from "esbuild";

// Shared esbuild policy for both runner-bundle bundling steps (the in-container
// vault-cli binary in bundle-cli.ts and the container entrypoint in
// bundle-entrypoint.ts). These lists encode properties of the shared
// dependency tree, not of either entry point, so they must stay identical —
// a package added to one bundler's externals but not the other's would fail
// only at the unguarded bundle's first production cold start.
//
// Externals resolve from the installed node_modules at runtime instead of
// being inlined into the bundle:
// - ink/react/react-devtools-core: the interactive chat/setup UI stack. ink
//   drags yoga-layout (top-level-await WASM) into the graph, and react must
//   stay external alongside it so the lazy UI path never sees two React
//   instances (external ink resolving installed react while murph UI code
//   uses a bundled copy would break hooks dispatch).
// - sharp/zxing-wasm: native binaries and WASM assets resolved relative to
//   their own package directories; bundling their JS would detach it from
//   those assets.
// - provider SDKs: CLI-bundled workspace packages use these exact-pinned
//   clients at runtime. Their generated resources and serializers add several
//   megabytes when esbuild inlines them, while the runner already installs the
//   same dependency closure. Keep one on-disk SDK copy and resolve its root and
//   generated subpaths from that package.
// - @murphai/exercise-library: its runtime loads generated JSON artifacts via
//   `new URL("../generated/...", import.meta.url)`; inlining the JS moves
//   import.meta.url into the bundle directory and the assets stop resolving.
//   @murphai/health-commons used to share that constraint, but its generated
//   asset root is now image-pinned by Dockerfile ENV
//   MURPH_HEALTH_COMMONS_PACKAGE_ROOT and assembly probes set the same pin, so
//   its JS can inline while the installed package still carries generated/.
export const RUNNER_BUNDLE_SHARED_EXTERNALS = [
  "@elevenlabs/elevenlabs-js",
  "@elevenlabs/elevenlabs-js/*",
  "@junction-api/sdk",
  "@junction-api/sdk/*",
  "@linqapp/sdk",
  "@linqapp/sdk/*",
  "@murphai/exercise-library",
  "@murphai/exercise-library/*",
  "exa-js",
  "exa-js/*",
  "ink",
  "react",
  "react/*",
  "react-devtools-core",
  "sharp",
  "openai",
  "openai/*",
  "zxing-wasm",
] as const;

// Source-path markers that must never appear in either bundle's inputs.
// Guards the externals list against drift: a newly added import path that
// drags one of these packages into a bundle fails the assembly instead of
// shipping a duplicate runtime copy.
export const RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS = [
  "/@elevenlabs/elevenlabs-js/",
  "/@junction-api/sdk/",
  "/@linqapp/sdk/",
  "/@murphai/exercise-library/",
  "/exa-js/",
  "/ink/",
  "/react/",
  "/react-devtools-core/",
  "/sharp/",
  "/openai/",
  "/yoga-layout/",
  "/zxing-wasm/",
] as const;

type MetafileOutputImport = Metafile["outputs"][string]["imports"][number];

export function collectStaticRunnerBundleOutputPaths(
  metafile: Metafile,
  entryPath: string,
): Set<string> {
  return collectRunnerBundleOutputPaths(
    metafile,
    entryPath,
    (imported) => imported.kind !== "dynamic-import",
  );
}

export function collectLazyRunnerBundleOutputPaths(
  metafile: Metafile,
  entryPath: string,
): Set<string> {
  const staticOutputPaths = collectStaticRunnerBundleOutputPaths(
    metafile,
    entryPath,
  );
  const outputPaths = collectRunnerBundleOutputPaths(
    metafile,
    entryPath,
    () => true,
  );

  for (const outputPath of staticOutputPaths) {
    outputPaths.delete(outputPath);
  }

  return outputPaths;
}

function collectRunnerBundleOutputPaths(
  metafile: Metafile,
  entryPath: string,
  shouldFollowImport: (imported: MetafileOutputImport) => boolean,
): Set<string> {
  const outputPaths = new Set<string>();
  const pending = [normalizeMetafilePath(entryPath)];

  while (pending.length > 0) {
    const outputPath = pending.pop();
    if (!outputPath || outputPaths.has(outputPath)) {
      continue;
    }
    outputPaths.add(outputPath);

    const output = metafile.outputs[outputPath];
    if (!output) {
      continue;
    }
    for (const imported of output.imports) {
      if (!shouldFollowImport(imported)) {
        continue;
      }
      const importedOutputPath = resolveMetafileOutputImportPath({
        importedPath: imported.path,
        importerOutputPath: outputPath,
        outputPaths: metafile.outputs,
      });
      if (importedOutputPath in metafile.outputs) {
        pending.push(importedOutputPath);
      }
    }
  }

  return outputPaths;
}

function resolveMetafileOutputImportPath(input: {
  importedPath: string;
  importerOutputPath: string;
  outputPaths: Metafile["outputs"];
}): string {
  const { importedPath, importerOutputPath, outputPaths } = input;
  const normalizedImportedPath = normalizeMetafilePath(importedPath);
  if (normalizedImportedPath in outputPaths) {
    return normalizedImportedPath;
  }
  if (!normalizedImportedPath.startsWith(".")) {
    return normalizedImportedPath;
  }
  return normalizeMetafilePath(
    path.join(path.dirname(importerOutputPath), normalizedImportedPath),
  );
}

function normalizeMetafilePath(inputPath: string): string {
  return inputPath.replaceAll("\\", "/");
}
