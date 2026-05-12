I checked current `main` plus the uploaded Cloudflare docs pack. The important update: **the Cloudflare runner control token is already gone on `main`**. What remains is mostly cleanup around native Container defaults, old compatibility shims, and tests that still carry the old mental model.

From the docs pack: Cloudflare’s intended shape is exactly “Worker → Container-backed Durable Object → container process.” The docs say the `Container` class is the standard Worker API for container instances and wraps the Durable Object interface; it also extends `DurableObject` itself. Uploaded docs: `selected-pages/containers/container-class.md:15,134`. They also say `fetch()` forwards to the container and auto-starts it, while `containerFetch()` sends directly to the container process; `startAndWaitForPorts()` is the explicit readiness API when you need certainty before sending traffic. Uploaded docs: `container-class.md:464-466,540-566,670-711`.

## Current main branch state

The old token architecture appears removed in the important places:

`RunnerContainer` now has only `/health` and `/internal/workspace-invocation` URLs. It sends the runner request body as `{ job, runtimeCallbackBaseUrl }` with only a content-type header; no bearer header, no token persistence, no `/internal/control-health`, and no control-token env var. 

`container-entrypoint.ts` no longer accepts a `controlToken`, no longer reads `HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN`, and only parses `job` plus `runtimeCallbackBaseUrl`. 

`buildHostedRunnerSupervisorEnv()` now only returns `{ PORT }`. 

The tests have already been partly updated to expect no Authorization header and only `job` / `runtimeCallbackBaseUrl` in the child runner payload. 

So: **do not build more token-removal work. That part is basically done.** The cleanup now is removing leftover scaffolding and leaning harder on native Container class defaults.

## Hard delete / cleanup now

### 1. Delete `buildHostedRunnerSupervisorEnv()`

This function now only wraps `PORT`. Since Cloudflare supports class-level `envVars`, and the docs say class `envVars` apply to every start while `startAndWaitForPorts().startOptions.envVars` is for per-instance overrides, this should become a class field. Uploaded docs: `container-class.md:140-146,699-703`.

Change:

```ts
import { buildHostedRunnerSupervisorEnv } from "./runner-env.ts";

startOptions: {
  enableInternet: true,
  envVars: buildHostedRunnerSupervisorEnv({ port: RUNNER_PORT }),
}
```

to:

```ts
export class RunnerContainer extends Container {
  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  envVars = { PORT: String(RUNNER_PORT) };
}
```

Then delete:

```ts
buildHostedRunnerSupervisorEnv()
```

from `runner-env.ts`.

This is a clean native-API win: the port is not per invocation, so it should not be passed per start.

### 2. Remove redundant `ports: RUNNER_PORT` and `containerFetch(..., RUNNER_PORT)`

You already set:

```ts
defaultPort = RUNNER_PORT;
requiredPorts = [RUNNER_PORT];
```

Cloudflare docs say `startAndWaitForPorts()` resolves ports from explicit `ports`, then `requiredPorts`, then `defaultPort`; and `containerFetch()` uses `defaultPort` if no port is supplied. Uploaded docs: `container-class.md:140-141,699-700,548-560`.

So this:

```ts
await this.startAndWaitForPorts({
  ports: RUNNER_PORT,
  ...
});

await this.containerFetch(RUNNER_HEALTH_URL, init, RUNNER_PORT);
```

can become:

```ts
await this.startAndWaitForPorts({
  cancellationOptions,
});

await this.containerFetch(RUNNER_HEALTH_URL, init);
```

Small, but it removes a bunch of repeated incidental plumbing.

### 3. Remove explicit `enableInternet: true`

Docs say `enableInternet` defaults to true. Uploaded docs: `container-class.md:145`; `platform-details/outbound-traffic.md:63`.

The runner needs internet for model calls / callbacks, so default true is the correct default. Remove explicit `enableInternet: true` unless you want it as documentation. If the priority is minimalism, delete it.

### 4. Delete dead `warmOnly` plumbing in `RunnerContainer.invokeHostedExecution`

`HostedUserRunner` no longer imports or calls `invokeHostedExecutionContainerRunnerIdleCheckpointIfWarm`; it only calls `invokeHostedExecutionContainerRunner`.  But `RunnerContainer.invokeHostedExecution()` still takes:

```ts
options: { warmOnly?: boolean } = {}
```

and branches on `options.warmOnly`.

That is now dead. Delete the parameter and branch:

```ts
const containerReady = await this.ensureContainerReady(input);
```

Keep `openWarmContainerIfReady()` only if `runPendingIdleCheckpoint()` still uses it. From current `runner-container.ts`, it does. 

### 5. Delete internal browser-vault container shims

`RunnerContainer` still exposes inert/throwing methods:

```ts
refreshBrowserVaultReplica()
abortBrowserVaultRefresh()
```

and the container process still has `/internal/browser-vault-refresh` returning 410.  

That is no longer a native Cloudflare concern and no longer part of the runner control plane. I would delete:

```ts
refreshBrowserVaultReplica?
abortBrowserVaultRefresh?
```

from `HostedExecutionContainerStubLike`, the class methods, and the `/internal/browser-vault-refresh` branch in `container-entrypoint.ts`.

Caveat: the Worker/UserRunner still has deploy-skew compatibility methods for browser-vault refresh, with comments saying delete after May 23 / May 25, 2026.   I would keep those public DO/Worker compatibility shims until the skew window is over, but the **container-side** browser-vault route looks safe to delete sooner because current code no longer calls it.

### 6. Delete `ContainerProxy` export unless you are actually using outbound interception

`index.ts` still exports:

```ts
export { ContainerProxy } from "@cloudflare/containers";
```

Current tests explicitly assert `RunnerContainer.outboundHandlers` is empty and that legacy outbound handlers are not installed.  Cloudflare docs say `ContainerProxy` is needed for outbound interception / allowed-host handling. Uploaded docs: `selected-pages/containers/platform-details/outbound-traffic.md:51-58`.

If there is no `allowedHosts`, `deniedHosts`, `outboundHandlers`, or `outboundByHost` usage left, delete the `ContainerProxy` export and the legacy outbound-handler tests/doubles. Your runtime callback route and `runner-outbound.ts` are app-level HTTP callback handling, not ContainerProxy interception. 

### 7. Clean stale test names and stale assertions

The test file still contains old framing like `evt_recovered_control_token`, repeated `readAuthorizationHeader(...).toBeNull()` checks, and legacy outbound-handler assertions. 

I would reduce this to one simple regression:

```ts
expect(observedTopLevelKeys).toEqual(["job", "runtimeCallbackBaseUrl"]);
```

Then delete `readAuthorizationHeader` unless another test truly needs it. The goal is to stop encoding “no token” as a first-class behavior. The behavior is simply: **typed DO method calls `containerFetch()` with a job payload**.

Also, the current main code makes `onStop()` observational: it logs `activeWorkspaceInvocationPresent` but does not abort active work.  If tests still expect `activeWorkspaceInvocationAborted: true` from `onStop()`, update/delete those. Active request failure should be covered by the status watcher path, not hook-side abort.

## Keep

### Keep separate `UserRunnerDurableObject` and `RunnerContainer`

Cloudflare docs say `Container` extends `DurableObject`, but they also warn not to override `alarm()` directly on a Container class because the Container class uses alarms for lifecycle; use `schedule()` instead. Uploaded docs: `container-class.md:134,1395`.

Your `UserRunnerDurableObject` uses its own `alarm()` for runner scheduling, while `RunnerContainer` uses container lifecycle.  That split is still the right clean architecture. Merging them would save a class but reintroduce lifecycle coupling.

### Keep `startAndWaitForPorts()` plus `/health`

Cloudflare says `startAndWaitForPorts()` is the safest explicit readiness API when you need certainty before traffic. Uploaded docs: `container-class.md:670-711`.

You also use `/health` to return runner bundle metadata from the container process.  That is more than “port is open,” so keep it.

### Keep per-user container naming

`HostedUserRunner` resolves the runner container name from the user ID before invoking the container binding.  That is the clean ownership boundary.

### Keep Worker callback signing and write-fence auth

These are real cross-system/app-level trust boundaries, unlike the deleted container control token. `UserRunner` validates and records runtime write fences, and `runner-outbound.ts` uses write-fence checks for writes.  

### Keep `onStop()` logging-only

Cloudflare’s `onStop` params are only `exitCode` and `reason`. Uploaded docs: `container-class.md:235-247`. That is not enough identity to safely attribute a stop event to the currently active invocation after destroy/restart races.

The current main branch is directionally correct: `onStop()` logs; active work is failed by request/status watching, not by unaffiliated lifecycle hooks. 

### Keep `DeploySmokeRunnerContainer` for now

It is extra config, but it gives separate `max_instances`, rollout settings, and lifecycle namespace from live per-user runners. Current Wrangler config has separate live and smoke container classes/bindings.  I would not collapse this unless you are comfortable losing that isolation.

## Maybe simplify later, but not first

`stopWarmContainer()` / destroy polling is probably more custom than ideal. Cloudflare docs say `destroy()` resolves after the runtime has destroyed the container and triggers `onStop()`. Uploaded docs: `container-class.md:1100-1115`.

Long term, the simplest version would be closer to:

```ts
await this.destroy();
```

with one timeout wrapper and one log. But I would not delete all destroy-status polling until you are confident the previous Wrangler/local stale-container issue is gone. This is a “measure then simplify” item, not a hard-delete-now item.

## Clean target shape

The runner container should end up roughly like:

```ts
export class RunnerContainer extends Container {
  defaultPort = RUNNER_PORT;
  requiredPorts = [RUNNER_PORT];
  pingEndpoint = RUNNER_PING_ENDPOINT;
  sleepAfter = formatRunnerSleepAfter(readRunnerContainerIdleTtlMs({}));
  envVars = { PORT: String(RUNNER_PORT) };

  override async fetch(): Promise<Response> {
    return methodNotAllowed();
  }

  async invoke(payload: HostedExecutionContainerInvokeRequest) {
    return this.withLifecycleLock(async () => {
      const input = parseHostedExecutionContainerInvokeInput(payload);
      await this.ensureContainerReady(input);
      return this.postRunnerRequest(...);
    });
  }
}
```

No token. No per-start supervisor env builder. No explicit default port arguments. No `enableInternet: true`. No internal browser-vault route. No ContainerProxy unless outbound interception is active.

## My recommended PR order

First PR: mechanical native Container cleanup.

Delete `buildHostedRunnerSupervisorEnv`, move `PORT` to `RunnerContainer.envVars`, remove explicit `ports`, remove explicit `RUNNER_PORT` args to `containerFetch`, remove `enableInternet: true`, and delete dead `warmOnly`.

Second PR: compatibility cleanup.

Delete container-side browser-vault refresh shims. After the deploy-skew dates pass, delete `scheduleDashboardReplicaRefreshForUser`, `scheduleBrowserVaultRefreshForUser`, `HostedBrowserVaultRefreshScheduleResult`, and optional compatibility methods in `UserRunnerDurableObjectStubLike`.

Third PR: test/model cleanup.

Delete old control-token/authorization helper assertions, legacy outbound-handler tests, and stale `onStop` abort expectations. Keep tests focused on the actual model: `containerFetch()` sends only `{ job, runtimeCallbackBaseUrl }`, readiness uses native Container APIs, and active request failure is detected through the status watcher.

Bottom line: **main has already made the important architectural move. The remaining win is to stop passing around configuration that the `Container` class already owns, then remove compatibility shims that keep reminding the codebase of the old token/proxy architecture.**
