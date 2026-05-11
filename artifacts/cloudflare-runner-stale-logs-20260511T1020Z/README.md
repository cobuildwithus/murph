# Cloudflare Hosted Runner Stale Invocation Log Bundle

Generated: 2026-05-11T10:20:00Z
Worker: murph-hosted
Window A: 2026-05-11T09:45:00Z..2026-05-11T10:15:00Z
Window B: 2026-05-11T10:05:00Z..2026-05-11T10:20:00Z
Deployed commit under investigation: <REDACTED_COMMIT_SHA>
Script version observed in logs: <REDACTED_VERSION_ID>

Privacy redaction:
- Cloudflare account IDs removed.
- Container and Durable Object IDs in proxy messages are redacted.
- Request IDs and script version IDs are redacted; correlate by timestamp and message class.

What this bundle captures:
- Repeated active invocation lease expiry.
- Stale local invocation cleanup.
- Workspace invocation failure.
- Immediate wake fallback failures.
- destroyInstance/proxy abort symptom.
- RunnerContainer lifecycle stop/start and platform reset/network-loss signals.

High-level symptom:
The runner is accepting work, then the active invocation stops proving liveness. The UserRunner DO clears stale state and starts recovery, while RunnerContainer logs aborted in-flight proxy requests during destroy/stop. This prevents a single invocation from completing and committing a reply.
