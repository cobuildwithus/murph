# Initial Notes For Handoff

Observed repeated sequence:
1. UserRunnerDurableObject alarm or RPC logs `Hosted workspace invocation lease expired; clearing stale in-flight state.`
2. Same request logs `Hosted runner workspace invocation failed.`
3. Same request logs `Hosted runner cleared stale local invocation so pending nudge can drain.`
4. Same request logs `Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled.`
5. RunnerContainer destroyInstance logs `Error proxying request to container <CONTAINER_ID>: Error: workspace invocation container destroyed`.
6. RunnerContainer lifecycle hooks often show stop/start nearby; sometimes platform logs `Network connection lost` and `Internal error in Durable Object storage caused object to be reset.`

Important interpretation:
- The destroyInstance proxy error is downstream cleanup noise. The upstream failure is that the active invocation stops heartbeating / proving liveness.
- The pattern predates the idle-checkpoint teardown change and continues after it.
- The idle checkpoint success log `Hosted runner completed idle-shutdown checkpoint cleanup without container destroy.` was not seen in the failing window; this is foreground invocation recovery, not quiet idle checkpoint cleanup.

Questions for code investigation:
- Is the runner child actually sending heartbeats during long foreground work?
- Is the heartbeat path blocked by proxy token, local-internal URL, or body/header preservation?
- Is ACTIVE_INVOCATION_HEARTBEAT_STALE_MS=3000 too aggressive for Cloudflare Containers/DO scheduling under load?
- Does recovery call destroyInstance too eagerly, causing cascading container stop/start before pending work can complete?
- Are RunnerContainer alarm/lifecycle hooks racing with active invocation state or DO storage reset?
