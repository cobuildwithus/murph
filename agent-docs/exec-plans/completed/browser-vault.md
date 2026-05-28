You’re right that **same-container warm-workspace refresh** is the best fit. The important correction is:

> Same container: yes.
> Same foreground invocation / same active write fence / same awaited runtime drain: no.

The simplest maintainable shape is a **container-local, killable background refresh** that is triggered by assistant-runtime dirty detection, reads the warm workspace, and saves only through a browser-vault-only Cloudflare port. It must not be UserRunner work, must not be `nextWakeAt` work, and must not hold the foreground runtime write fence.

## Codebase constraints

The current foreground invocation path installs an outbound proxy/write authority for one workspace invocation, sends the runner request, parses the result, then expires/cleans up the active operation/proxy in `finally`.  So a naive `void refreshBrowserVault()` started inside the foreground runtime cannot safely keep using the normal runtime ports after the foreground request returns.

The current browser-vault replica port also requires the workspace checkpoint bridge / runtime write fence. That is correct for foreground runtime writes, but it means background browser-vault writes need a different, narrower authority. 

The good news: you already have a warm per-user workspace root in the isolated runner path, and the hosted runtime restore layer has warm/local workspace cache semantics.   That makes same-container warm-workspace refresh natural.

Also good: the old detached `/internal/browser-vault-refresh` side path is gone and now returns `410`, which is the right baseline. Do not bring that old path back. 

## Final recommended shape

```txt
Foreground invocation:
  assistant runtime writes/mutates warm vault
  assistant sends reply/outbox
  assistant marks browser-vault dirty locally
  foreground invocation returns to Cloudflare

Container-local background manager:
  notices local dirty marker after foreground result
  starts a separate background child/process
  child reads warm vault
  child builds browser-vault replica
  child writes/publishes through browser-vault-only Cloudflare port
  child clears dirty marker

Next foreground invocation:
  container kills/aborts browser-vault background child first
  revokes browser-vault background token
  starts foreground reply immediately
```

This gives you the property you care about:

```txt
Browser-vault refresh never participates in the foreground UserRunner drain,
never holds the foreground write fence,
and is killed before new foreground work begins.
```

It can still consume machine resources while running, so don’t run it on the main Node event loop. Run it in a child process or worker thread. That lets the HTTP server accept/abort/start foreground work immediately.

## What not to do

Do not put browser-vault refresh into:

```txt
UserRunner wakePending
UserRunner nextWakeAt
UserRunner retry
idle checkpoint
foreground HostedWorkspaceInvocationResult await chain
foreground runtime write fence
```

That would reintroduce “background work can block replies.”

Also avoid expanding `HostedWorkspaceInvocationResult` just to carry a browser-vault refresh request if possible. The runner transport currently parses invocation results through `parseHostedWorkspaceInvocationResult`; adding opaque result fields means touching the hosted-execution contract/parser path.  A local marker file is simpler.

## Minimal migration guide

### Phase 1 — add stable query-source hashing

Current `listCanonicalSourceManifest` includes `mtimeMs`, which is useful as a manifest but wrong as a stable source identity. 

Add a query helper:

```ts
export async function hashCanonicalQuerySources(vaultRoot: string): Promise<{
  hash: string;
  files: Array<{
    relativePath: string;
    sizeBytes: number;
    sha256: string;
  }>;
}>;
```

Hash sorted records of:

```txt
relativePath
sizeBytes
contentSha256
```

No mtime. No generatedAt. No user id. No workspace version.

Also expose one predicate:

```ts
isCanonicalQuerySourcePath(relativePath: string): boolean
```

Use the same roots as query source loading.

### Phase 2 — add a local dirty marker

Put this in warm workspace runtime state:

```txt
vault/.runtime/operations/browser-vault/refresh-state.json
```

Shape:

```ts
type BrowserVaultRefreshState = {
  schema: "murph.hosted-browser-vault-refresh-state.v1";
  dirty: boolean;
  dirtySince: string | null;
  dirtyReason: "query_source_changed" | "query_source_deleted" | null;
  lastPublishedSourceHash: string | null;
  inProgressSince: string | null;
  failureCount: number;
  nextAttemptAt: string | null;
};
```

This is local runtime state, not canonical truth.

### Phase 3 — mark dirty from canonical write receipts

The canonical write receipt action shape already gives you the needed data: `text_upsert`, `jsonl_append`, `raw_upsert`, and `delete`, with `effect` / `existedBefore` fields. 

Dirty rules:

```txt
text_upsert if effect !== "reuse" and target is query source
jsonl_append if target is query source
delete if existedBefore === true and target is query source
```

Ignore:

```txt
raw_upsert
.runtime/**
derived/projection/cache files
text_upsert reuse
delete existedBefore false
non-query-source paths
```

Foreground path should do no network refresh. It only writes the tiny local dirty marker best-effort.

### Phase 4 — add container-local background manager

Add a small singleton in `container-entrypoint.ts` or a nearby module:

```ts
class BrowserVaultBackgroundRefreshManager {
  private active: {
    abortController: AbortController;
    child?: ChildProcess;
    token: string;
    userId: string;
  } | null = null;

  abort(reason: string): void {
    this.active?.abortController.abort(new Error(reason));
    killChildProcessGroup(this.active?.child);
    this.active = null;
  }

  schedule(input: BrowserVaultBackgroundRefreshInput): void {
    if (this.active?.userId === input.userId) return;
    this.abort("superseded");
    this.active = startBackgroundRefreshChild(input);
  }
}
```

On every new `/internal/workspace-invocation` request:

```ts
browserVaultBackground.abort("foreground invocation starting");
revokeBrowserVaultBackgroundToken();
```

Do this before starting the foreground child.

After the foreground invocation returns its normal result:

```ts
void browserVaultBackground.scheduleIfDirty({
  userId,
  warmVaultRoot,
  backgroundToken,
  localInternalProxyBaseUrl,
});
```

Do not await it.

### Phase 5 — add a browser-vault-only Cloudflare port

This is the one necessary Cloudflare seam.

Do **not** reuse the foreground runtime write fence. Add a scoped authority:

```ts
type BrowserVaultBackgroundAuthority = {
  token: string;
  userId: string;
  expiresAt: string;
  scope: "browser_vault_background";
};
```

It can only do:

```txt
write encrypted browser-vault replica object
publish latest browserVaultReplicaRef
optionally mark latest ref stale
```

It cannot do:

```txt
workspace checkpoint
provider effects
email/Linq/Telegram/WhatsApp sends
artifact writes outside browser-vault replicas
mailbox mutation
device-sync mutation
```

In `runner-outbound`, keep foreground write-fence checks for normal runtime writes. Add a separate background-browser-vault auth path only for browser-vault routes.

### Phase 6 — background child refresh algorithm

The background child should be read-only against warm vault, except for its local refresh-state marker.

Algorithm:

```txt
read refresh-state
if not dirty or nextAttemptAt is in future: exit

compute sourceHashBefore
if sourceHashBefore === lastPublishedSourceHash:
  mark clean
  exit

build browser-vault replica from warm vault

compute sourceHashAfter
if sourceHashBefore !== sourceHashAfter:
  keep dirty
  exit

write replica through browser-vault-only port
publish latest ref through browser-vault-only port
mark clean with lastPublishedSourceHash = sourceHashAfter
```

If aborted at any point:

```txt
discard
keep dirty
exit
```

If failure/oversize:

```txt
keep dirty
failureCount += 1
nextAttemptAt = backoff
exit
```

No exception from this path should affect foreground reply.

### Phase 7 — empty replica rule

Always publish an empty valid replica if query-visible content was deleted.

Do not skip because the source is empty. Skipping can leave stale private data visible.

For delete-sensitive changes, the best privacy behavior is:

```txt
dirtyReason === "query_source_deleted"
  background child first calls mark-stale/clear-latest
  then builds/publishes the new empty/current replica
```

That mark-stale call is still background and non-blocking. If you need strict privacy before reply returns, that becomes a different tradeoff because it requires a foreground network side effect.

## Why this is simpler than alternatives

This avoids all of these:

```txt
no UserRunner browser-vault scheduler
no browser-vault Durable Object
no browser-vault alarm
no foreground/background priority in Cloudflare
no browser-vault nextWakeAt
no holding foreground write fence
no bringing back old /internal/browser-vault-refresh
```

It adds only:

```txt
one local dirty marker
one container-local background manager
one background child process
one browser-vault-only save/publish port
```

That is the minimum needed to refresh from warm workspace without blocking replies.

## Tests to add

```txt
foreground query-source write creates local browser-vault dirty marker
raw write / reuse / delete miss does not mark dirty
foreground invocation response does not await browser-vault refresh
background refresh uses warm vault root and writes through browser-vault-only port
new foreground invocation aborts active background refresh before starting
aborted background refresh does not publish
source hash changes during build -> discard and keep dirty
delete last visible item -> publishes empty replica
old /internal/browser-vault-refresh still returns 410
```

## Final invariant

```txt
Browser-vault refresh is a warm-container background side effect.

Assistant runtime detects dirtiness.
The container runs refresh in a killable background child.
Cloudflare provides only a browser-vault-only save/publish port.
UserRunner never schedules, waits for, retries, or prioritizes browser-vault refresh.
New foreground work aborts refresh before it starts replying.
```

That is the cleanest version I see that satisfies “warm workspace” and “should never block incoming replies.”
