import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { unstable_dev } from "wrangler";

it("resumes a checkpoint after its separate barrier-control object hibernates", async () => {
  // The Workers Vitest pool forces no_handle_cross_request_promise_resolution.
  // Use an ordinary local Worker so this regression keeps production semantics.
  const worker = await unstable_dev(fileURLToPath(new URL("./fixtures/checkpoint-barrier-worker.ts", import.meta.url)), {
    config: fileURLToPath(new URL("./fixtures/checkpoint-barrier.wrangler.json", import.meta.url)),
    envFiles: [],
    ip: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    local: true,
    persist: false,
    logLevel: "none",
    experimental: {
      disableDevRegistry: true,
      disableExperimentalWarning: true,
      enableContainers: false,
      forceLocal: true,
      testMode: true,
      watch: false,
    },
  });
  try {
    expect(await (await worker.fetch("/arm?target=control")).text()).toBe("armed");
    const publications = Promise.all([
      worker.fetch("/wait?target=opaque").then((response) => response.text()),
      worker.fetch("/wait?target=opaque").then((response) => response.text()),
    ]);
    await vi.waitFor(async () => {
      expect(await (await worker.fetch("/status?target=opaque")).text()).toBe("entered");
    });
    // Keep the real waiting checkpoint alive while its separate control object
    // passes the native hibernation window without requests or keepalives.
    await new Promise<void>((resolve) => setTimeout(resolve, 22_000));
    expect(await (await worker.fetch("/release?target=control")).text()).toBe("true");
    await expect(Promise.race([
      publications,
      new Promise<string[]>((resolve) => setTimeout(() => resolve(["checkpoint did not resume"]), 1_000)),
    ])).resolves.toEqual(["checkpoint resumed", "checkpoint resumed"]);
  } finally {
    await worker.stop();
  }
});
