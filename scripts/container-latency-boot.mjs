import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

// CI probe: exercise the packaged runtime without work or provider requests.
const entry = await import("/app/dist-bundled/container-entrypoint.js");
const server = await entry.startHostedContainerEntrypoint({ port: 0 });
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const deadline = Date.now() + 60_000;
  while (true) {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { connection: "close" },
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.poisoned, false);
    assert.notEqual(health.heavyRuntimeHydrationStatus, "failed");
    if (health.heavyRuntimeHydrationStatus === "ready") {
      const cpu = process.cpuUsage();
      console.log(JSON.stringify({
        scenario: "boot",
        wallMs: health.heavyRuntimeHydrationCompletedAtEpochMs - health.processStartedAtEpochMs,
        cpuMs: (cpu.user + cpu.system) / 1_000,
      }));
      break;
    }
    assert.ok(Date.now() < deadline, "Heavy runtime hydration exceeded deadline");
    await setTimeout(10);
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
