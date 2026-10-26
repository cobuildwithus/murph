// Preload for benchmark-event-read-import.mjs; never writes to CLI result streams.
import { statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const receipt = process.env.MURPH_EVENT_READ_BENCH_RECEIPT;
const bundle = process.env.MURPH_EVENT_READ_BENCH_BUNDLE;
if (!receipt || !bundle) throw new Error("event-read-probe-configuration-missing");
const trace = process.env.MURPH_EVENT_READ_BENCH_TRACE === "1";
const loaded = new Map();
if (trace) registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith("file:") && !loaded.has(url)) {
      const file = fileURLToPath(url);
      const relative = path.relative(bundle, file);
      const outside = relative.startsWith("..") || path.isAbsolute(relative);
      // Only installed package-relative labels leave the process. pnpm store
      // directory names can encode host paths, so never publish those prefixes.
      const marker = "/node_modules/";
      const normalized = file.replaceAll("\\", "/");
      const offset = normalized.lastIndexOf(marker);
      loaded.set(url, {
        module: offset < 0 || outside ? "other-file" : normalized.slice(offset + marker.length),
        fileBytes: statSync(file).size,
        sourceBytes: result.source == null ? null : Buffer.byteLength(result.source),
        outside,
      });
    }
    return result;
  },
});

process.once("exit", (exitCode) => {
  // Sample before serializing/writing the receipt. Normal CLI teardown has run;
  // parent spawn-to-close wall time also includes this probe's exit write.
  const cpu = process.cpuUsage();
  const childWallMs = performance.now();
  const modules = [...loaded.values()];
  writeFileSync(receipt, JSON.stringify({
    exitCode, trace, childWallMs, cpuMs: (cpu.user + cpu.system) / 1_000,
    inventory: trace ? {
      modules: modules.length,
      fileBytes: modules.reduce((sum, item) => sum + item.fileBytes, 0),
      sourceBytes: modules.reduce((sum, item) => sum + (item.sourceBytes ?? 0), 0),
      sourceUnavailable: modules.filter((item) => item.sourceBytes === null).length,
      outsideBundle: modules.filter((item) => item.outside).length,
      core: modules.filter((item) => item.module.startsWith("@murphai/core/"))
        .sort((left, right) => left.module.localeCompare(right.module)),
      cliChunks: modules.filter((item) => item.module.startsWith("@murphai/murph/.bundle/"))
        .reduce((sum, item) => ({ modules: sum.modules + 1, fileBytes: sum.fileBytes + item.fileBytes }),
          { modules: 0, fileBytes: 0 }),
    } : null,
  }));
});
