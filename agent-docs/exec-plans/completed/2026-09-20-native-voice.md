# GPT-Live voice on the website

Status: completed
Created: 2026-09-20
Updated: 2026-09-21

## Goal

- Let an authenticated member talk to Murph on the website through native Codex voice, with the existing engine retaining sole process, tool, and runtime ownership. The selected path is a minimal Codex compatibility patch for the public GPT-Live API, preserving native transcript and delegation handling.

## Success criteria

- Prove the selected provider path and hosted ownership before building product integration.
- Reuse Codex conversation, tools, steering, and result routing; prefer native transcript/delegation handling when supported and remove redundant host assumptions where proof supports deletion.
- Preserve authenticated member scope, accepted-work durability, canonical writes, cancellation, and usage settlement.
- Verify microphone-to-speaker behavior, successive turns, correction, tool calls, disconnect, and runtime shutdown. Report provider or deployment gaps honestly.
- Ship the patched CLI through the existing runner base-image workflow. Pin the public upstream revision and patch, preserve the matching sandbox resources, and include all build inputs in the image fingerprint. Local hosted development and deployment must consume the same package; no manual binary replacement or second release service.

## Scope

- In scope: pinned-binary compatibility probe; a deletion-first engine change; authenticated website media/control integration; narrow provider routes; focused proof and ReviewGPT review.
- Out of scope: a separate voice agent/sideband coordinator, a general voice framework, new task queues, automatic reconnection orchestration outside Codex, and unrelated cleanup.

## Constraints

- After comparing maintenance tradeoffs, the user selected a minimal Codex patch to use the public API with an already-entitled project key. Preserve native voice owners rather than building a Murph voice adapter. Keep the patch narrow and reproducible. The native path must hand normalized input to the existing durable acceptance owner before backing work; verify that boundary on the pinned release before adopting it. Publishing artifacts and production deployment remain separate from local implementation and PR verification.
- Provider secrets remain at the existing boundary. Development tests use synthetic inputs; production credentials are unavailable locally.
- One existing runtime owner admits effects. Live answers stay in their accepted
  call. Explicit future reminder requests use the member's canonical direct
  messaging destination and disclose that channel in the confirmation.
- Build the smallest coherent interaction; use existing browser media primitives and design components.

## Risks and mitigations

1. Native V3 has a different wire contract from public Live. Prove the actual pinned binary against a synthetic provider, then check development project access before committing to product architecture.
2. Native handoffs can start backing turns internally. Prove host event/tool binding and accepted-input ownership before admitting writes.
3. Native voice lifecycle and usage may lack host evidence. Inspect and test these boundaries; do not add a second sideband as a workaround.

## Tasks

1. Inspect native source, runtime boundaries, and existing browser integration; ask ReviewGPT for a concrete deletion-first integration recommendation.
2. Run the pinned native V3 protocol probe with synthetic credentials and events; separately establish authorized development API compatibility.
3. Collapse the smallest proven engine boundary, retaining a single event/tool/process owner.
4. Integrate authenticated browser voice and exact provider routes, with product output and usage at existing boundaries. Reserve a pending call before a clean runtime can return; keep the live handle within the existing invocation, fence by its attempt/generation, and close before release. Wire native input through authenticated durable mailbox admission and selected post-checkpoint outbox speech through the exact call port. Reuse the existing member delivery route for future scheduled notifications; an ephemeral call cannot become a durable reminder destination.
5. Run focused tests/typecheck, native and rendered proof, review complexity, and complete scoped commit/PR/review and authorized release work.

## Product UX plan

- Outcome: an authenticated individual member can speak to their existing Murph
  assistant and hear its selected answer, with microphone and end-call control.
- Entry and promise: a dashboard Voice link opens one call page. Start requests
  microphone permission, shows connection progress, and then displays microphone
  state and readable answer captions. Calls use the existing AI allowance.
- Affected journeys: signed-out entry uses the existing sign-in dialog; a denied
  microphone, unsupported browser, expired session, access/allowance rejection,
  slow startup, lost connection, mute, explicit end, and navigation away all have
  a visible safe outcome. Voice is an individual channel, not a group destination.
  Existing text conversations and durable scheduled delivery remain available.
- Proof: test browser media lifecycle against the real authenticated control
  contract, inspect production components at phone and desktop widths, then run
  the composed native/provider/mailbox/tool/speech/shutdown journey.
- Done when: start never happens on page load, stop immediately releases the
  microphone, stale startup cannot reopen media, retries reuse the same offer and
  call, and the member can read or hear the result. Current verdict: Ready for the
  verified synthetic hosted journey; production rollout remains separate.

## Implementation decisions

- Keep the existing Codex 0.153.4 release (`3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`) and matching bundled helpers. The main-based prototype proved public compatibility; its patch is backported to the release to avoid adopting unrelated upstream changes. Build only the patched CLI in the existing runner base image. The Dockerfile and native patch jointly identify the cache input.
- Preserve native transport and transcript normalization while using Murph's existing turn lifecycle. The native acceptance-handshake experiment passed 522 checks and real browser speech, but accepting native start-or-steer still bypasses the engine's prepared prompt and competes with its turn binding. A real comparison using normal host `turn/start` passed the same two spoken tool-backed requests and trusted closure. Replace the handshake with a small opt-in normalized-input notification (`clientManagedInputs`) and use the existing durable mailbox, context preparation, start/steer, and presentation owners. This removes custom admission callbacks, deadlines, cancellation gates, and protocol response types. The replacement notification implementation also passes real browser speech: two host-started backing turns, two successful read-only tools, audible answers, and provider-confirmed closure with trusted final cumulative usage. Full hosted wiring remains unverified; both comparisons used a synthetic host, not Murph's complete runtime.
- No implementation is justified solely by a feature flag existing; compatibility and host ownership are the first proof gates.
- The engine attachment uses an ephemeral media thread with no Murph tools on its existing resident process. This avoids creating a backing thread before the ordinary turn path has prepared its tools, prompt, model, and durable session binding. A composed synthetic test passed two ordinary host turns while voice stayed connected, selected speech, and provider-confirmed closure before process shutdown. The attachment fences stale/closing input, accepts cancellation during startup, and keeps voice events out of another turn's captured output. It adds no second process or work queue. The start response confirms managed input ownership, rejecting older binaries that silently ignore the flag before SDP reaches the browser. Its 298 protocol checks, schemas, scoped Clippy, formatting, and full CLI build pass. The corrected public Live filter runs five app-server cases, all passing with four requiring the native test runner retry; no clean first-attempt claim is made. The packaged CLI passes the composed engine/native tests. Real browser speech through the engine attachment also passes: two synthetic inputs durably recorded by the proof host, two ordinary turns reading a fixture through the shell, audible selected results, and provider-confirmed shutdown with trusted final cumulative usage of 19 seconds. This is engine composition evidence, not the hosted mailbox or website. Six notification failure/cancellation tests and the 50 existing runtime-turn tests pass; engine typecheck passes. Complexity remains below the existing baseline with no new function above 20.

## Verification

- A native AMD64 Blacksmith Testbox now runs the complete hosted stack with the
  existing inner Codex permission enforcement. The first successful composed run
  durably consumed one spoken input, used a successful read-only tool, returned
  audible fixture content, stopped the microphone, received provider-confirmed
  closure, settled two trusted usage rows, and reached hosted completion. Browser
  connection took 39.9 seconds and speech-to-answer took 21.0 seconds in the local
  development stack. Earlier runs timed out after the acknowledgement; temporary
  metadata-only native tracing confirms the selected answer reaches the provider.
  A clean repeat without diagnostics also passes every assertion: connection
  44.7 seconds, speech-to-answer 24.3 seconds, one consumed input, and two trusted
  usage rows. These two successes are compatibility evidence, not a reliability
  rate; the earlier acknowledgement-only timeouts remain recorded. The temporary
  Testbox is stopped and its workflow scaffold removed from the candidate.
  The fixture now derives its replica object key through the
  canonical storage helper after the original placeholder reproduced an orphan
  namespace error. Its synthetic microphone supplies continuous silent frames.
- The user waived publication of a temporary visual preview. Inspected synthetic
  screenshots remain local; no preview was published. The hosted PR Evidence
  design-URL requirement is a separately reported gate, not a fabricated pass.

- The authenticated hosted browser now connects through Web, Worker, container,
  and native Live. Synthetic spoken input is durably admitted; provider-confirmed
  closure and trusted usage recording return successfully. The backing read-only
  tool and spoken answer remain unproved in the composed hosted test. Bounded
  diagnostics proved that the ordinary backing thread fails during filesystem
  instruction discovery, then normal process failure closes voice. The local
  AMD64 image is emulated on an ARM64 Docker engine: the default Docker profile
  blocks nested namespaces; enabling the existing smoke settings for only this
  test's disposable containers exposes unsupported seccomp installation in the
  emulator. Native Linux permission-confinement CI already passes. Do not weaken
  the inner sandbox or interpret an emulated failure as native Linux failure.
  A native AMD64 development runner is the remaining execution prerequisite;
  its connection details have been requested. No production fix follows from
  this environment diagnosis. Temporary application diagnostics were removed,
  and the clean production bundle passes all eight parity probes and its size
  guard. The browser driver now
  reports premature call closure promptly instead of waiting its full answer
  deadline. Web and Cloudflare typechecks passed for the proof-driver changes.
  The reproducible local limitation is recorded in Frog.

- The next composed retry isolated cancellation to the routine foreground-idle
  mailbox handoff, with no budget exhaustion, shutdown, or abort. Reserved/live
  calls now count as foreground work at that existing decision. The clean voice
  wait also routes explicit processing-mode requests through the existing handoff
  handler; a timed regression proves prompt closure rather than waiting for the
  reservation to expire. The mailbox follow-up regression failed before the fix;
  all 42 selected voice, checkpoint, and runtime-collapse cases pass. Temporary
  diagnostics emitted only fixed categories and were removed. The full hosted
  browser journey is being retried after rebuilding the clean runner bundle.
- The composed hosted browser test reproduced a process-busy failure when a
  system-only wake checkpoint overlapped native media negotiation. The engine
  now holds its existing process slot lock through attachment, rather than
  exposing startup as a competing ordinary turn. A matching active turn can
  share the media thread without surrendering its reservation. The native
  checkpoint regression failed before the fix; four packaged native cases and
  44 existing process cases pass, including voice attachment during an ordinary
  turn. Engine typecheck, complexity, and runner bundle parity/size checks pass.
  The authenticated hosted browser proof is being rerun with that bundle.
- The bounded native builds pass. Linux run `35597350646` at `698ec03fc4c8`
  passes all three packaged native cases, 29 provider compatibility/egress cases,
  and final-image permission confinement. Its unchanged native recipe compiled
  in 55 minutes 19 seconds; the local emulated build compiled in 74 minutes
  21 seconds. A forced source rebuild using the warm local Docker cache passed
  in 1.51 seconds. This proves local layer reuse, not cross-runner persistent
  cache activation or timing. The later runtime and process-start changes still
  need final-head CI. The first hosted attempt stopped before a call because host CLI 0.155.1
  lacks the harness's legacy smoke-model template. The matching pinned 0.153.4
  CLI supplies it; the rerun uses that CLI on its process PATH. This reproducible
  harness version dependency is recorded in Frog, without changing production
  model selection. The composed test then exposed missing fixture controls and
  a CommonJS browser-driver entrypoint; both are corrected, with Cloudflare/Web
  typechecks passing. Full hosted voice remains unverified.
- Parent review reproduced final usage escaping shutdown's accounting join when
  the provider receipt arrived between a completed ledger write and its promise
  cleanup. The existing flush loop now joins the next write, including failure,
  instead of launching it detached. Both success and failure regressions failed
  before the fix; all 26 focused usage, lifecycle, and checkpoint cases now pass,
  together with runtime typecheck and complexity. No state, queue, or retry policy
  was added. The queued hosted proof was stopped before refreshing its bundle;
  the bounded native image and Linux image CI continue unchanged.
- Linux run `35593710568` built the patched image in about 34 minutes, then
  failed two raw native fixtures because SDP arrived before their WebSocket
  attachment. The resident-process media/ordinary-turn case passed. The fixtures
  now await their actual sideband connection before sending synthetic input.
  Local packaged Codex passes all three cases; stock Codex passes both applicable
  cases with the patched-only case skipped. Engine typecheck passes. Linux
  provider-route and sandbox steps did not run after this fixture failure; a
  new current-head run remains required.
- Source review now documents the voice Web-admission retry/query bounds in
  `ARCHITECTURE.md`: at most two HTTP attempts sharing the commit deadline, two
  serial root-preparation attempts per request, 55 conservative database
  statements per request excluding transaction control, and provider work
  outside the append transaction. This covers the Web admission owner and its
  KMS/Temporal calls; measured composed latency remains pending hosted proof.
- The local Linux release link exhausted Docker memory after about 74 minutes;
  Docker recovered without a restart. Cargo now uses two jobs instead of the
  VM's full CPU count, retaining the upstream release optimization profile.
  Twenty-one packaging/fingerprint checks and Cloudflare typecheck pass; a fresh
  bounded build is running, so resource sufficiency is not yet proven. The
  admission-order runner bundle passed size and executable parity guards.
- Parent review reproduced an admission-response race: Web can commit and wake
  backing work before the call receives its local acceptance receipt, causing a
  valid selected answer to be rejected. Speech now joins the existing admission
  promise before validating the receipt and rechecking call liveness. The new
  delayed-response case failed before the fix; it and the concurrent-hangup case
  now pass with 24 focused lifecycle, checkpoint, and usage checks. Runtime
  typecheck and complexity pass, with no new state or queue. The queued hosted
  proof launcher was stopped before rebuilding the changed runner bundle; the
  local native image build and independent Linux CI continue.
- The hosted voice proof additionally requires existing runtime diagnostics to
  show a successful tool action with no file changes, alongside the correct
  spoken fixture answer. Cloudflare typecheck and the focused durable tool-log
  regression pass. The full hosted proof has not run: the local Linux image
  build remains active while Docker API reads are unresponsive. An independent
  Linux image/compatibility/sandbox run is active at candidate `8df7d351c967`.
- The normal production runner bundle builds with the current source and stays
  within its entrypoint and static-closure budgets. The complete patched Linux
  base image is building through the existing `runner:docker:base` command;
  hosted proof waits for its exact source fingerprint. The opt-in `native-voice`
  hosted-local scenario is implemented but not yet executed. It uses the real
  authenticated Voice page and replaces only the physical microphone with
  synthetic speech. Web, Worker, and harness typechecks pass, as do the eleven
  existing harness-selection checks and the complexity guard.
- The member-facing `talk-with-murph` changelog fragment and Voice component
  pass twelve focused rendering tests. Four Playwright phone/desktop cases pass
  for the actual call controls and changelog card, with no horizontal overflow;
  rendered images are inspected. Repeated panels now use React-generated label
  IDs. Public preview publication and the full hosted audio journey remain
  unverified; this is not release approval.

- Complete initial provider input was captured from the real stock base CLI and
  patched candidate CLI against the same credential-free Responses fixture,
  using production prompt layers, registered tools, and the hosted model catalog.
  At base `ce8cd609a197` and candidate `449a45afce46`, the individual fixture is
  30,665 `o200k_base` tokens / 143,059 UTF-8 bytes, and the group fixture is 28,016
  tokens / 128,690 bytes. Both normalized requests are byte-identical: zero token
  delta, zero byte delta, 0.00% growth. Counts use `gpt-tokenizer` 3.4.0 over the
  complete captured JSON, not provider billing estimates. Normalization removes
  only transport cache identity and replaces generated message/installation/turn
  IDs, turn-start time, and local fixture/install/temp paths with fixed values;
  all instructions, messages, tool data, and static request fields remain.
  The normal mixed-mode catalog keeps automation deferred; this first-request
  proof does not claim its later loaded description/schema is unchanged.

- Voice reminder routing now uses Web's canonical direct member destination,
  read lazily through the existing signed effects bridge only on save or explicit
  retarget. Inspect and ordinary patches retain the stored route without a
  routing request. Missing destinations and group routes reject before writing;
  the shared future-delivery validator rejects ephemeral voice calls. The model
  receives the actual delivery channel and a distinct notification binding.
  Focused proof passes 265 tests across route validation, runtime automation and
  notification, Web authority, Worker transport/policy, and tool serialization.
  Relevant engine, runtime, operator-config, Worker, and Web typechecks pass.
  The focused real-Codex journey on `gpt-5.6-terra` through local subscription
  authentication passes: exactly one successful tool call and canonical reminder
  save, the exact intended local time, and a concise confirmation naming Telegram
  as the separate destination. Reply review: Ready for this reminder journey.
  Its first executable attempt exposed missing synthetic accepted-time context;
  the next exposed an ambiguous current-conversation binding and an avoidable
  support-field validation attempt. The fixture now supplies the real accepted
  reference window; production output distinguishes the notification binding,
  and support-field schema guidance states their paired, plan-owned scope.
  Full browser-to-hosted speech and deployment evidence remain separate gates.

- The dashboard now links to the member Voice page. Its browser controller owns
  only microphone, WebRTC, answer captions, and the existing authenticated
  reservation/connect/close requests. It starts only on an explicit action,
  preserves one offer across readiness retries, stops media before waiting for
  closure, and fences late permission/reservation/answer results. Fifty-four Web
  controller, component, sidebar, and route cases pass, together with Web typecheck,
  eight public package-resolution checks, dependency policy, and complexity.
  Production component rendering passes at 390px and 1440px without overflow;
  the idle, muted, and microphone-denied states are inspected. These are browser
  lifecycle and presentation proofs. The real authenticated hosted journey,
  scheduled notification route, final deployment proof, and final review remain.

- Public Live creation and attachment now pass through the existing Worker egress
  owner. A stateless signed reference binds the provider resource to the exact
  member and runtime; native cancellation can still attach and close while that
  owner retires. Browser permissions stay restricted to media controls and close.
  The packaged patched CLI passes both ordinary closure and cancellation during
  an in-flight creation through the actual egress implementation, with trusted
  final usage. Eighteen focused cases pass with the native binary; 39 egress,
  inventory, and image-contract cases pass without it (two opt-in native cases
  skip). Cloudflare typecheck and complexity pass; egress debt falls from 11 to 7.
  The Linux image workflow now runs the same native egress cases. These fixtures
  prove native/policy composition, not Cloudflare's deployed WebSocket forwarding
  or the complete authenticated browser/mailbox journey.
- Dependency policy and ignored-build review pass without new script approvals.
  The two test-only WebSocket dependencies reuse versions and snapshots already
  present in the lockfile; no package snapshot or production dependency changes.
  `pnpm deps:audit` fails with 109 repository-wide advisories (3 critical, 45 high,
  54 moderate, 7 low). This is an unresolved audit result, not a passing check;
  the patch does not introduce or upgrade any audited package version.

- Public Live media now selects the managed OpenAI API provider even when local
  text turns use ChatGPT subscription authentication. Generated configuration
  registers both providers without changing the backing target or process owner.
  Sixty-six configuration and lifecycle checks pass (seven opt-in native auth
  scenarios are skipped), together with runtime typecheck and complexity. This
  proves configuration selection, not provider egress or the final hosted call.

- Web reservation, connection, and close now reach the existing invocation's
  voice handle through member-bound OIDC control and the persisted container
  target. Admission checks session, origin, active access, consent, and allowance;
  close remains available after policy revocation. Every effect retains the exact
  member, attempt, generation, and call. The container forwards over direct TCP
  without starting a stopped runner. Old containers reject missing capability,
  and stale commands cannot affect a current call. Focused proof passes 276
  container/abort/owner cases, 18 shared parser cases, and 15 Web route cases.
  Cloudflare, Web, shared protocol, and control client typechecks pass. Complexity
  passes; extracting the existing wake request body lowers container entrypoint
  debt by 11. Another 77 container/control, 26 Worker authorization, and 80 control
  client/route checks pass, including private malformed-body rejection. These are
  component proofs; provider egress authorization, browser
  UI, and the final composed journey remain unfinished.

- The Cloudflare wrapper now supplies the invocation's voice handle with its
  actual signed mailbox and usage ports. Cold admission carries only an opaque
  reservation in the existing job; warm admission forwards it through the exact
  owner wake. Shared readers reject reservations in background processing modes.
  A container rejects voice reservation before its live owner is ready, leaving
  ordinary pending-wake coalescing unchanged. The wrapper closes and joins the
  handle on every exit. A synthetic native callback is proved through the actual
  platform port, including bound member/attempt/generation headers and final
  admission join. The invocation-builder and container HTTP wake proofs pass:
  128 focused Cloudflare cases, 67 shared protocol cases, and Cloudflare typecheck.
  Complexity passes with unchanged container/preparation debt and one fewer
  point in the invocation wrapper. The HTTP connection/close command, Web call
  controller, provider egress authorization, browser UI, and final journeys remain.

- Signed normalized-input admission now reaches the existing encrypted Web mailbox.
  The request cannot select a member; the callback supplies the identity and signed
  attempt/generation, which Web rechecks inside publication with active access,
  consent, foreground mode, and platform usage authority. Crypto preparation stays
  outside the transaction. Stable call/input identity and timestamp preserve exact
  replay; conflicting content returns 409, and successful duplicates repeat the
  post-commit wake. The existing Worker mailbox port owns one transport replay.
  Fifteen route/owner-composition cases, fourteen prepared-append regressions, and
  ten Worker mailbox-port cases pass. Shared, runtime, Web, and Cloudflare typechecks
  pass; complexity adds no debt. These use synthetic ports: the native callback
  and authenticated browser call-control are still unwired, and the complete
  browser-to-hosted-mailbox journey remains required.

- The existing hosted invocation now consumes the voice handle: an empty reserved call remains alive, dirty work checkpoints and drains selected delivery while the call stays open, and call close or graceful shutdown releases the invocation. New reservations are fenced synchronously before returning, and pending background writes are quiesced before the clean/dirty decision. Checkpoint preparation keeps media attached; final cleanup joins closure and accounting. The speech port reaches the real assistant-phase runtime platform. Native voice and ordinary work share one configuration-preparation promise. The composed empty-invocation proof initially observed a foreground waiter rather than sustained invocation lifetime; it now checks the outcome and fails when the new clean-call wait is removed. The checkpoint case caught premature media closure in the initial shared-cleanup implementation; that ownership boundary is corrected. Focused invocation, shutdown, scheduling, checkpoint, system-preemption, and lifecycle cases pass. Web/Worker/container call-control wiring, signed input admission, scheduled notification routing, and the complete browser journey remain unfinished.

- The hosted engine voice facade now derives the same process launch as ordinary turns, retaining the backing provider while selecting OpenAI only for the tool-free media thread. Parameterized launch-identity proof covers OpenAI, Venice, and custom inference. The ephemeral call handle bounds an unattached reservation, serializes mailbox admission, restricts selected speech to accepted inputs on the exact call, fences late input, and joins admission plus trusted final usage on close. The existing hosted outbox now supplies that speech port behind its runtime liveness checks; progress delivery has no voice port. Focused lifecycle, accounting, callback, and wrapper tests plus package typechecks pass; complexity adds no debt. This is component evidence: no authenticated call-control endpoint, runtime reservation/keepalive loop, or Web mailbox writer is connected yet. Next, connect the handle at the existing invocation boundary before clean return, preserve post-checkpoint delivery while a call remains open, and bind Web admission to the current runtime attempt/generation. Future scheduled notifications still need the existing durable member route.

- Voice now has a conversation payload and reply adapter in the existing owners. Native input identity and call identity round trip through the mailbox contract; the text admission path deduplicates replay, gives successive inputs the same blinded conversation, and persists an input before notifying an active turn. Managed auto-reply enables durably admitted voice work independently of media lifetime. The adapter requires a private accepted reply and an invocation-bound speech port, does not infer another channel, and uses the existing non-idempotent outbox semantics. Canonical inbox projection also persists and deduplicates normalized voice without attachment jobs. The duplicated launch-time managed-channel list is replaced by the existing shared builder. Focused shared-contract, canonical-inbox, channel, runtime-admission, context, configuration, and parser tests pass; engine, runtime, shared, inbox, Web, and Cloudflare typechecks pass. Complexity adds no debt or new hotspot. These are component boundaries; the authenticated call owner and its port remain to be wired.


- Public WebRTC creation now restricts browser commands to mute, unmute, and close; native sideband instructions and selected results retain their existing trusted owner. The missing-capability regression failed before the fix; all 186 API tests then passed, followed by scoped Clippy, formatting, full CLI build, source applicability verification, nine packaged engine/native cases, and engine typecheck. A real browser rejected valid synthetic instruction and commentary commands, accepted mute/unmute, completed two ordinary read-only tool-backed spoken requests on one backing thread, and received provider-confirmed closure with 20 seconds of trusted usage. The first permission probe omitted the required nullable delegation field and proved only syntax validation; that probe was corrected before the successful permission assertion.

- The Linux managed-input image run at `274acd079d47` passed all steps, including exact packaged CLI compatibility, egress inventory, and native permission confinement: https://github.com/cobuildwithus/murph/actions/runs/35568356782. This predates the start-response confirmation and subsequent engine/billing work; final-head proof remains required.

- Native voice billing now has a bounded recorder and pricing through the existing immutable usage ledger, without a new billing table or queue. One in-flight write coalesces provider totals; an uncertain response retains the exact immutable record for final-flush replay. Failed accounting or exhausted allowance closes the call, and an explicit null notice target prevents cross-channel fallback. Pricing is the difference between cumulative costs at the [published $0.05/minute rate](https://developers.openai.com/api/docs/models/gpt-live-1), so event partitioning does not compound rounding. The runtime recorder's seven cases and 149 Web pricing/allowance cases pass, as do runtime, shared-contract, and Web typechecks. Complexity passes, reducing the existing pricing dispatcher debt by grouping its audio pricing branches. This is component evidence: the recorder still needs the actual hosted call owner, and no website voice feature is enabled by this commit.

- Pinned-binary local provider probe: verify exact RPC, HTTP, and sideband event shapes without provider calls.
- Passed the pinned 0.153.4 native V3 compatibility test: one WebRTC create, one native sideband, two successive backing turns, two tool calls on the same thread, native result forwarding, and explicit stop. No host `turn/start` requests or live provider calls were used.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-native-voice.test.ts --no-coverage`: passed.
- `pnpm --dir packages/assistant-engine typecheck`: passed.
- The initial authorized local/development credential returned HTTP 401 with `account_deactivated`. The replacement root development key is active; no credential values were recorded or copied.
- The replacement key passed a public GPT-Live session probe: `POST /v1/live/sessions` returned 201, WebRTC connected, and `session.closed` reported `close_requested` with final `usage.seconds` of 15. The key stayed in the server process. This was silent connectivity evidence, not native tools or hosted deployment proof. Current native V3 instead posts multipart to `/v1/live` and received 403 with either its default model or explicit `gpt-live-1`. The [public WebRTC contract](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) differs; the explored public API-key path has a demonstrated compatibility gap, but this does not establish that Murph needs a fork. A fresh upstream fetch through `bb054a2b03` contained no such transport change.
- Native subscription access is proven: after pre-provider authorization failures on earlier profiles, an already-authenticated local Codex profile received the V3 SDP answer and reached browser WebRTC `connected`. The probe received the native closed notification, then closed its own browser peer. This silent synthetic probe ran zero backing turns and sent no microphone audio. It does not prove hosted API-key access, audio quality, provider-resource closure, or usage settlement.
- A synthetic spoken request subsequently completed the full native path: browser audio input, one backing turn, one successful read-only dynamic tool, the correct backend answer, and the matching spoken answer with received audio. The provider owns all delegation and result forwarding. Earlier exploratory samples acknowledged the request or reported lookup failure, so this is compatibility evidence rather than production UX acceptance.
- A host-finalized output probe also passed: `clientManagedHandoffs: true` retained native backing-turn/tool ownership and suppressed automatic result forwarding; after a successful synthetic tool, the host sent its selected result via `thread/realtime/appendText` with assistant role, and the browser received the correct spoken answer. This is a candidate seam for the existing Murph presentation owner, with no second sideband. Successive turns, cancellation, and stale-result association still need composed production-owner proof.
- The live browser channel emitted `session.usage.updated` with `audio_duration_ms`; the inspected native V3 parser does not expose that event to the host. Browser-reported usage cannot become billing authority. Native host usage evidence remains a release gap.
- Native stop does not close the live provider resource in the tested pin: after `thread/realtime/closed`, a fresh synthetic audio input still produced provider `input_transcript.added` and `turn.created` events. No backing turn or tool ran after stop. Current upstream sideband teardown drops the connection, while the existing writer `close()` sends `session.close` but is not called by that teardown. Fix and verify native provider shutdown and final usage together before treating runtime revocation as complete.
- A local upstream candidate on `fix/live-owned-session-shutdown` now calls the existing close operation for sessions Codex created. Its app-server regression first failed for the missing provider message and then passed. A real connected-session probe received `session.closed` and accepted no subsequent synthetic audio. That first candidate did not fix the independently reproduced immediate-stop race while the native sideband was still connecting and was not a Murph dependency upgrade.
- The upstream candidate is committed as `f81044280b`. All 201 focused realtime tests across `codex-core` and `codex-app-server` passed; two app-server cases needed an initialization-timeout retry. Rust formatting and diff checks passed. Full-workspace testing remains pending the confirmation explicitly required by upstream `AGENTS.md`.
- The early-stop native candidate is committed as `5f553892b8`: the existing sideband owner finishes an in-flight join only long enough to close its owned Live session, with a five-second bound and an unconfirmed-shutdown error on failure. The regression failed for the missing provider close request before the fix. Fourteen focused shutdown/reconnect/tail checks then passed; one case retried after an initialization timeout. `just fmt` and diff checks passed. A real synthetic early-stop probe received provider `session.closed`, accepted no post-stop audio, and ran zero backing turns/tools. This remains local upstream code, not the Murph pin or final usage settlement.
- The native provider's `session.closed` frame includes final `usage.audio_duration_ms` and `usage.backend_model_usage`. A short synthetic connected-close probe observed zero audio duration. The native parser currently discards this frame, and the existing writer closes its WebSocket immediately after requesting session closure. A host usage contract must preserve the provider's final receipt; browser observations are compatibility evidence only.
- A synthetic event-order probe observed a backing provider request before the host received that turn's completed user-message notification. Notifications alone do not establish pre-provider durability. ReviewGPT initially recommended a native, awaited pre-input admission request, but withdrew its necessity claim on reassessment. Event ordering proves the race, not that modifying Codex is the only solution. The existing command-based UserPromptSubmit hook is insufficient: failures and invalid responses can continue processing, and it lacks a stable per-input identity.
- The owner reduction passed 261 focused tests across process, recovery, tools, steering, turns, events, and subagent usage, plus the assistant-engine typecheck. Production source is reduced by 36 lines; measured complexity debt falls from 201 to 193. Same-batch RPC/tool identity, account response policy, compaction ordering, and tool draining have explicit regression coverage.
- Focused engine, hosted runtime, Worker, and Web tests plus relevant typechecks as implementation scope becomes concrete.
- Passed `pnpm test:assistant:live -- --test "real model canonical meal persists across assistant restart"` on the previously verified local subscription profile with `gpt-5.6-terra`: two provider turns, one canonical meal save, then correct readback after assistant restart and vault restore. Reviewed both synthetic replies: Ready for this preserved text journey. Website voice remains Hold.
- ReviewGPT review of the complete stable candidate; provider and deployment evidence remain separate completion requirements.

## Review round 1 remediation

- Accepted the original-PR finding that sideband loss could release the runtime
  usage owner while independent browser/provider media remained active. The user
  resumed remediation. The native owner now makes one close-only attachment to
  the same call, within its existing five-second shutdown deadline, and drains
  the provider's final usage before completion. It neither creates a new session
  nor replays uncertain outbound work; failed cleanup remains unconfirmed.
- Real-socket regression: the three cleanup cases failed before the fix; afterward
  all seven public-Live app-server cases passed, including confirmed close, EOF,
  timeout, already-confirmed closure, and both native tool-backed turn modes.
  Four cases needed the runner's retry after an app-server initialization timeout.
  Formatting and pinned upstream patch applicability pass.
- Reconciled main while preserving voice ownership and mailbox wake high-water
  handling. Container-entrypoint tests (63), shared protocol tests (76), image
  contracts (21), and relevant shared/Cloudflare typechecks pass. The merged
  parser derives its effective processing mode once for both admission guards
  and the existing runtime admission check.

## Implementation and review closeout

- Final GPT-6 Pro round 2 passed with zero findings at
  `9908459e4165ff1d6bef6147b69b53b939f6affe`. Exact response identity, model, and
  response hash were verified; capture took more than twelve minutes. The
  original sideband-loss finding is resolved, and the owned browser target is
  closed. The parent agrees with the result.
- CI exposed stale inventories for the new Worker route, hosted exports, and
  static voice page. Test-only corrections preserve vendor telemetry suppression
  on voice. Their focused suites pass 163, 10, and 11 tests, with Cloudflare,
  shared-protocol, and Web typechecks passing.
- The latency proof's ten-minute native-image setup deadline expired before any
  benchmark ran. Image preparation now permits up to ninety minutes per checkout;
  the enclosing step permits two builds and the existing benchmark budget. The
  one-vCPU sample limits, semantic checks, and regression thresholds are unchanged.
  Comparator tests, workflow policy, syntax checks, Actionlint, and complexity
  checks pass. The task-owned Frog entry records this setup failure.
- These post-review edits are isolated verification scaffolding and explanatory
  evidence; production source, deployment configuration, schemas, and the reviewed
  native patch are unchanged. They use the review loop's non-substantive-change
  exception. Final exact-head CI remains a live PR gate after this closeout commit.
- The user waived preview publication. The URL-shape evidence check remains an
  explicitly disclosed waiver, not a fabricated preview or weakened guard.
  Neither PR has been merged, and no deployment or binary publication occurred.

## Current prerequisites

- The clean native AMD64 hosted browser/tool/speech/accounting journey now passes.
  Earlier acknowledgement-only timeouts are retained as a provider-repeatability
  limitation; the final review must not infer a production reliability rate.
- Feature ReviewGPT and parent final review are complete. Required exact-head CI
  for the final verification-only commit remains pending in the live PR. The
  temporary public preview is waived by the user; keep the resulting PR Evidence
  URL-gate limitation explicit.
- [Deployment companion PR #166](https://github.com/cobuildwithus/murph-cloud/pull/166)
  passes typecheck, 827 coverage tests, 131 controller tests, production build,
  10 built-worker tests, exact-head CI, and final GPT-6 Pro review with zero
  findings at `887173ad3878f52218a720f40a9f1a9daa934453`. The pinned Blacksmith
  Docker builder uses one shared cache in the existing protected smoke/deploy
  jobs; forced source builds remain authoritative. Sticky Disks branch protection
  is enabled, so only default-branch jobs persist shared cache writes. Local
  forced warm source builds complete in 1.51 seconds. Protected cross-runner warm
  timing is still unproven and must be measured during an authorized rollout.
- No production deployment, rollback, or patched-binary publication is authorized
  or performed by this implementation/PR task.

## Published-only investigation outcome

- [OpenAI's official integration example](https://openai.com/index/introducing-gpt-live-1-in-the-api/) connects public Live client delegation to published Codex. It omits connection and delegation handling. Adapting this pattern to Murph's existing app-server path is a candidate, not completed integration proof.
- The smallest candidate keeps browser media separate from the existing runtime's trusted Live attachment, admits requests through the existing durable mailbox, and returns selected results through the existing presentation owner. Client delegation requires bounded transcript context and delegation correlation; it does not supply a complete task prompt.
- Concrete work remains: authenticated admission, scoped provider WebSocket transport, voice lifetime between turns, cumulative voice usage accounting, and result targeting. Multiple steered callers can share one final result, so independently speaking each resolved promise would duplicate or misroute output.
- ReviewGPT recommends proving those boundaries on the actual hosted runner before committing to a full adapter. Waiting for native support could remove transcript/delegation glue, but would still require website auth, runtime lifetime, and billing integration. This historical assessment preceded the user's choice of the minimal native compatibility patch; it does not authorize another task/recovery owner.

- Selected direction after discussion: native compatibility patch. The public adapter remains a comparison, not the implementation plan. Prove the patch and its distribution before changing Murph's dependency or admitting website voice work.
Completed: 2026-09-21
