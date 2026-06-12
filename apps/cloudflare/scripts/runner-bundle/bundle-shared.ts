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
// - @murphai/health-commons/@murphai/exercise-library: their runtimes load
//   generated JSON artifacts via `new URL("../generated/...", import.meta.url)`;
//   inlining the JS moves import.meta.url into the bundle directory and the
//   assets stop resolving (June 2026 deploy smoke failure: ENOENT on
//   @murphai/murph/generated/protocol-index.json).
export const RUNNER_BUNDLE_SHARED_EXTERNALS = [
  "@murphai/exercise-library",
  "@murphai/exercise-library/*",
  "@murphai/health-commons",
  "@murphai/health-commons/*",
  "ink",
  "react",
  "react/*",
  "react-devtools-core",
  "sharp",
  "zxing-wasm",
] as const;

// Source-path markers that must never appear in either bundle's inputs.
// Guards the externals list against drift: a newly added import path that
// drags one of these packages into a bundle fails the assembly instead of
// shipping a duplicate runtime copy.
export const RUNNER_BUNDLE_SHARED_FORBIDDEN_INPUT_MARKERS = [
  "/@murphai/exercise-library/",
  "/@murphai/health-commons/",
  "/ink/",
  "/react/",
  "/react-devtools-core/",
  "/sharp/",
  "/yoga-layout/",
  "/zxing-wasm/",
] as const;
