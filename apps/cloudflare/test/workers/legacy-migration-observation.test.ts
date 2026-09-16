/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { observeLegacyRuntime } from "../../src/user-runner/legacy-runtime-observation.ts";
import type { DurableObjectStateLike } from "../../src/user-runner/types.ts";

it.each([false, true])("observes Cloudflare KV and alarm metadata with Miniflare name metadata: %s", async miniflareName => {
  const namespace = (env as { USER_RUNNER: DurableObjectNamespace }).USER_RUNNER;
  const stub = namespace.get(namespace.idFromName(`synthetic-migration-observation-${miniflareName}`));
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.put("runtime-migration-freeze:v1", { schema: "murph.legacy-runtime-freeze.v1", phase: "frozen" });
    await state.storage.setAlarm(Date.now() + 60_000);
    if (miniflareName) {
      state.storage.sql.exec("CREATE TABLE IF NOT EXISTS __miniflare_do_name (id INTEGER PRIMARY KEY, name TEXT)");
      state.storage.sql.exec("INSERT OR REPLACE INTO __miniflare_do_name (id, name) VALUES (1, 'synthetic-migration-observation')");
    }
    const tables = state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map(row => row.name);
    expect(tables).toContain("_cf_KV");
    expect(tables).toContain("_cf_METADATA");
    const observation = await observeLegacyRuntime({ storage: state.storage as DurableObjectStateLike["storage"], waitUntil: promise => state.waitUntil(promise) });
    expect(observation).toMatchObject({ kind: "observed", schemaVersion: 21, userId: null });
    expect(state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map(row => row.name)).toEqual(tables);
    state.storage.sql.exec("CREATE TABLE unclassified_application_state (id TEXT PRIMARY KEY)");
    expect(await observeLegacyRuntime({ storage: state.storage as DurableObjectStateLike["storage"], waitUntil: promise => state.waitUntil(promise) }))
      .toEqual({ kind: "unsupported_schema", schemaVersion: 21 });
    await state.storage.deleteAlarm();
  });
});
