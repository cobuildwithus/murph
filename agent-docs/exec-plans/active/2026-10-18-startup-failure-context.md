# Startup failure context telemetry

## Outcome and invariant

Make the existing failed-startup observation distinguish a retained native refusal
from an ordinary port refusal or missing cause, and record the synchronous native
running flag at the same catch. Preserve all readiness, cancellation, ownership,
cleanup, retry, success, log severity, and log-count behavior.

## Evidence and ownership

Synthetic installed-SDK reproductions show both cancellation labels can arise
without a healthy transition. A native refusal can survive in the direct cause,
while another SDK branch loses it. The existing warning records only the outer
cancellation boundary. Native running is optimistic and cannot prove health.
Current logs can be joined manually; retained context on the existing exact-attempt
warning makes that distinction available when native logs are absent or expired.
Provider allocation or quota reasons remain outside this observation's evidence.

RunnerContainer's cold wait catch and existing structured-log pipeline own the
observation. No product state, new log stream, infrastructure, provider calls,
SDK/dependency modification, metrics series, or new persistent owner is needed.
Use fixed vocabularies only; no error prose, payload, identifier, or stack.

## Implementation and proof

1. Have ReviewGPT implement bounded direct-cause classification and a synchronous
   native-running snapshot on the existing warning, with guarded diagnostics.
2. Keep both fields absent before the cold wait catches and on success/noncold
   failures. Unknown or unreadable values must stay explicit and must not alter
   the original failure or cancellation reason.
3. Add focused owner tests and actual installed-SDK reproduction coverage for
   both abort labels, retained/lost causes, optimistic running, privacy and
   throwing getters; prove new behavior fails on base and passes on candidate.
4. Parent review, Cloudflare typecheck, complexity and docs checks; final pushed
   candidate ReviewGPT and required CI; merge and canonical deployment under
   standing authorization, coordinating the release slot.
5. Verify actual deployed revision and relevant outcomes immediately, then via
   the existing native heartbeat mechanism for four hours at 30-minute intervals.

## Compatibility and product impact

Optional metadata in an existing failure-only log is additive across old/new
Workers. Container image, Web and Temporal contracts, database schemas, runtime
behavior and initial model input stay unchanged. No member-visible changelog.
No new awaited work or calls on the foreground path. A normal full gated release
remains canonical; no rollback, replay, recovery, or configuration mutation.

## Ownership and disposition

Reuse this task's existing clean checkout, updated to current main. Open PR3994's
actual diff changes idle-cleanup veto ordering, not this cold-wait catch; no
concrete collision. Other task branches and release ownership are preserved.
No telemetry claims provider capacity or allocation cause without evidence.

## Progress

- Original occurrence outcome investigation complete; no unresolved job identity
  is used to justify telemetry.
- ReviewGPT authored the implementation and tests; the parent inspected all
  source changes and added a real structured-log round-trip assertion.
- Fourteen new owner scenarios failed against the original owner source because
  the fields were absent. Candidate: all 301 owner tests and all 20 installed,
  patched-SDK tests pass. Cloudflare typecheck, docs drift and whitespace pass.
- Complexity guard passes: new classifier maximum 7, unchanged existing runner
  debt and maximum. The existing 72/31/24 hotspots do not justify unrelated
  restructuring for this failure-only observation.
- Privacy and runtime-cost proof covers fixed labels, no nested traversal or
  coercion, throwing accessors, original error identity, pending fences, cleanup,
  one warning, and unchanged state/health/start call counts.
- Reused the existing exact-artifact-download Frog report after validating and
  rejecting an unrelated image; exact metadata export and retry recovered the
  patch. A new public-safe Frog entry records omitted SDK patch context; the
  final canonical snapshot will explicitly include the tracked patch and mapping.
- Final pushed-candidate ReviewGPT, required CI, merge, canonical deployment and
  natural observation remain pending. Native provider allocation cause remains
  unresolved; these fields retain available evidence rather than infer it.
