# Security

Last verified: 2026-08-09

## Non-Negotiable Rules

- Treat `.env` and `.env.*` files as secret inputs. Murph's CLI may load local `.env.local` and `.env` files at runtime for operator credentials, but agents and runtime logs must never print, fixture, package, or commit their contents.
- Do not share raw filesystem archives of a repo clone for review or support. Ignored local `.env` files and build output such as `.next/` can leak through a clone/archive even when git has no tracked secret diff; use the guarded `scripts/package-audit-context.sh` / `pnpm zip:src` path instead, because it stages git-visible files and filters blocked local residue from the bundle.
- Public npm and GitHub Release publication must scan the final packed tarballs, not only tracked source. `scripts/release-artifact-secret-guard.mjs` owns that fail-closed boundary: packing runs it before writing the pack manifest, publishing reruns it before the first npm request, and the release workflow reruns it after downloading the handoff artifact and before creating permanent release assets. Pack manifests may point to the established caller-selected external output directory, but every listed tarball must remain a relative `.tgz` path in one exact inventory. Credential-key classification is shared across assignments and parameters and recognizes separator- and camel-case names; authorization serialization, command-prefixed shell assignments, and quoted JS/TS literals are scanned without treating opaque value shape as proof of safety. Unquoted JS/TS right-hand sides remain code expressions, while `KEY=value` in declaration files remains invalid and suspicious. Do not weaken scanning for bundled fixtures: omit proven non-runtime upstream test sources from the public payload and scan every file that ships under the same policy. Treat every artifact name and archive-entry path as untrusted in diagnostics and release logs: report only a tarball index, a fixed archive-entry marker, and rule ids. Keep the handoff artifact on one-day retention.
- The release artifact guard permits one generated public data store: `package/node_modules/@murphai/health-commons/generated/knowledge.sqlite`. This exact bundled path contains public authored Health Commons knowledge and no user data. Every other `.sqlite`, `.db`, backup, or dump path remains blocked.
- Keep sensitive identifiers out of committed fixtures, examples, screenshots, uploaded artifacts, and user/provider-facing output. Do not let identifier redaction block local root-cause debugging.
- Treat auth, wallet, payment, and health-related data flows as security-sensitive until documented otherwise.
- Hosted health-data withdrawal is authorized only by the durable
  `launch.health-data = revoked` grant. A missing legacy grant is not
  withdrawal. Write revocation before cleanup, and recheck it independently at
  AI, message, runtime-usage, health-source connection, webhook, scheduled
  sync, and companion-processing boundaries. The withdrawal response must wait
  for the per-user Cloudflare execution barrier to serialize behind earlier
  ensures, re-read the Web-owned grant, clear its write fence, and stop the
  runner. Every later ensure re-reads the grant; renewal waits behind the stop
  before granting. An instant-start or authenticated established-direct-chat
  typing shell-prewarm hint uses that same per-user barrier and live admission
  read. The typing producer resolves only the private home-chat blind index and
  performs an advisory active-access/root check after acknowledging the webhook;
  it receives no member id from Linq and grants no runtime authority. The shared
  HTTP route obtains the named runner stub without binding durable state.
  Because this hint is optional, it is admitted only when the barrier is idle;
  repeated hints and hints arriving during authoritative ensure, withdrawal, or
  deletion return without joining the FIFO. The
  optional read abandons after a fixed 250 ms
  deadline so it cannot hold authoritative processing, withdrawal, or deletion
  behind the ordinary Web-control timeout; only allowed admission reserves and
  binds its exact versioned container in the existing user-control stop-target
  field, then waits for the container to register the hint before releasing the
  barrier. Withdrawal and account deletion consume that exact target, while
  container destruction supersedes a pending platform wait before stopping it.
  Web admission also requires an
  extant, non-suspended member, so a hint queued behind account deletion cannot
  treat the deleted consent row as a compatible legacy grant and recreate
  runner state. Cleanup failure must never restore authority. Keep Settings,
  export, and deletion available without waking the paused runtime; only
  renewed consent may restore processing.
- Treat suspected breaches, unauthorized access, unauthorized disclosures, vendor incidents, and accidental tracking disclosures involving identifiable health data as FTC HBNR triage events; use `agent-docs/compliance/ftc-hbnr-incident-plan.md` before deciding that notice is not required.
- Do not add third-party advertising pixels, retargeting SDKs, behavioral ad attribution, customer-list matching, tag-manager destinations, or analytics destinations that receive health data or health-context metadata; use `agent-docs/compliance/health-data-tracking-and-ads-rule.md` for any telemetry or marketing-tool review.
- Hosted Web must keep the global `Referrer-Policy` at `strict-origin` or
  stricter so same-origin telemetry and script requests cannot inherit a
  document pathname, query, or fragment. Murph Safe retains its route-specific
  `no-referrer` override. Event-payload redaction is defense in depth and must
  not substitute for this transport-level boundary.
- Do not echo model API keys, base headers, or other provider credentials in CLI output, fixtures, or persisted artifacts.
- Hosted browser device OAuth is a same-host, same-member, initiating-browser boundary. Start must issue one short-lived host-only proof bound to provider, OAuth state, member, and app-session generation. Callback GET must validate that proof against the active session and pass the session member as exact `expectedOwnerId` before state consumption or provider exchange; it then redirects back into the app with no interstitial confirmation. A missing or invalid proof consumes only the OAuth state and redirects to Connect so a transferable provider callback cannot be relayed into the initiating member later. This proof is ephemeral and adds no durable state owner. `DEVICE_SYNC_PUBLIC_BASE_URL` may change the callback path but must use the hostname that served the authenticated browser start; Web start/runtime plus build validation must reject both explicit and derived split-host values before OAuth mutation. Cloudflare preflight verifies explicit callback overrides only. Keep both `__Host-` cookies host-only: do not add a Domain cookie or cross-host handoff. Suppress Vercel Analytics and Speed Insights on both hosted device callback path families so provider authorization query parameters never enter those vendors. Junction `pending_link` and `link_returned` accounts are inert until proof-verified callback completion: no webhook acceptance, dirty state, wake, scheduling, provider execution, canonical import, or sync-success promotion. Once a shared account is `source_confirmed`, adding or retrying another Junction-backed source must preserve that phase and all established siblings. Keep the target source `disconnected` and exclude only its webhook and pull work until the runtime establishment hook atomically commits source admission with durable initial work; shared ingress must not write that fact independently. Explicit disconnect or a newer connection epoch wins over a late callback, which fails without admitting the target. Retry cleanup may deregister only that target. Whole-account revoke remains exclusive to explicit connection-wide disconnect. Local and tunneled `device-syncd` callbacks remain a separate explicit daemon contract.
- Established shared Junction account preservation is one closed persistence
  contract across hosted and local operation. Shared ingress selects
  `preserve_established` for a source addition and `replace` for an account
  reconnect; hosted Prisma and local or tunneled SQLite must apply the shared
  predicate inside persistence rather than reinterpret a source addition as a
  reconnect. Provider polling is an admission reader, never an admission
  writer: it uses the complete upstream provider list only to resolve record
  provenance, rereads live source rows before projection and durable import,
  skips disconnected-source projection, and excludes disconnected-source
  summary and timeseries records. An unresolved source reference fails closed
  while any source admission is pending; a truly absent row retains the legacy
  admitted behavior.
- Composio connected-app authority is web-owned. Keep `COMPOSIO_API_KEY`, `OPENWEATHER_API_KEY`, remote Tool Router session ids, OAuth state, provider tokens, and full authorization URLs out of runner env, Codex prompts, diagnostics, logs, fixtures, and persisted workspace artifacts. The runner may call only the single signed connected-app control route; web must bind every operation to the callback-authenticated member, enforce approved toolkits plus read-only/non-destructive session tags, require explicit account selection for connected-account execution, and allow accountless execution only for server-owned built-in service tool slugs. Web may inject server-held OpenWeather custom auth only for the allowlisted Composio weather reads. The exact official-alert slug may instead call the fixed OpenWeather One Call origin and path with only validated latitude and longitude, a fixed section exclusion, a short timeout, no cache, a response byte limit, and a bounded normalized projection. The runner never receives the OpenWeather key and cannot choose the provider URL or add query arguments. Connected-app writes remain limited to the exact server-owned fixed-write allowlist: primary-calendar event creation plus bounded Gmail and Microsoft Outlook sends. Every fixed write requires agent approval, an active owned account from the matching toolkit, a pinned provider version, local missing, blank, unsupported, and server-owned argument rejection, and server-forced provider fields. Email sends additionally require current accepted user input in a private direct turn; scheduled, group, maintenance, system-notification, and output-only turns fail closed before provider egress. Failed or ambiguous writes are non-retryable, and an ambiguous email outcome may be reconciled only against a narrow recent Sent-mail window matching the primary recipient, subject, and substantive body; uncertain results remain unknown. Web must verify callback account ownership against Composio before showing success. Email, calendar, attachment, weather-alert, and other provider payloads are high-sensitivity untrusted data: full or raw payloads and free-form provider error messages must not be written to operational logs; Web may retain only bounded documented provider error codes or strict category slugs from a bounded failure body.
- Member memory consolidation retains its isolated network-denied model turn. Reminder availability has no model turn, model-facing tool, or separate permission profile: the hosted background automation pass deterministically selects only active non-exact-time direct automations with exact current `skip-when-busy`, `calendar-only`, and Google Calendar or Outlook account-binding lines. Host code derives the stored account, fixed provider tool, current seven-day window, arguments, and 256-item cap; rejects incomplete pagination and unsupported timestamps; reduces the response to merged busy instants; then rereads the exact automation and requires its version and source/account binding to remain unchanged before atomically replacing the engine-owned suffix. Complete empty reads persist only their bounded timestamps so refresh cadence needs no second state owner. Raw event titles, bodies, attendees, locations, URLs, and provider identifiers must not enter a model, memory, automation instructions, or logs. Ordinary saves and instruction patches strip the owned suffix; changing to an exact-time schedule also converts the policy to fixed and removes its source and account binding. Scheduled execution requires a non-exact-time schedule, current exact policy/source/account authorization, and a canonical snapshot covering an occurrence scheduled within 24 hours of generation. The timestamp-only suffix is removed before every provider prompt. Its host-only snapshot remains a bounded derived-data lease: disconnect or provider revocation blocks future reads but can leave the current lease usable for up to one day. Policy removal or account replacement invalidates it immediately; malformed or older evidence, failed first activation, and concurrent edits fail open to normal reminder delivery without a live account-status request on every occurrence.
- Habitat location is city-or-approximate-region data, never precise-address data. Reject a precise address at the ordinary Habitat write boundary, instruct voice extraction to discard it, and revalidate the canonical value immediately before weather-provider egress so an unsafe legacy record cannot leave Murph. Environment voice is AI work: first-seen uploads require the existing AI-usage gate and may create at most one unconsumed recording per member under the member lock. Exact duplicate retries may reuse the canonical claim without spending another admission because they cannot create additional work. Enforce the three-minute audio limit on server-side prepared media, not on the caller's duration field.
- Labs discovery is a web-owned, read-only Junction egress boundary. Keep `JUNCTION_API_KEY`, authorization headers, raw provider bodies, and raw provider errors out of browsers, runner env, prompts, diagnostics, logs, analytics, fixtures, and persisted product/runtime state. Catalog queries and ZIP codes enter Murph only through authenticated or signed POST bodies and must stay out of Murph diagnostics, logs, analytics, fixtures, and persisted state. Junction's official catalog, area, and PSC read endpoints require GET query parameters, so Web may place the bounded query or ZIP in a provider request URL only on the fixed production US origin and allowlisted paths. Never log or retain that full outbound URL; Murph-controlled HTTP telemetry may retain only method, origin, path, status, timing, and size. Junction receives the query parameter over TLS, and any provider-side URL retention is governed by the Junction account and contract rather than Murph's no-persistence claim. Web must use strict request and response parsing, explicit input/result/byte/time/location-fanout bounds, and sanitized failure codes. The authenticated browser API binds the current app session; the assistant API binds the member through the signed callback and is exposed only to verified private direct turns. Group and unverified audiences fail closed. Cloudflare may carry only the normalized semantic request/response and must not receive the credential or choose a member. Provider catalog facts are untrusted external data: display only the normalized projection, never render provider HTML, and do not infer medical necessity, eligibility, booking, or a final price.
- Personal hosted-group awareness and self-leave are self-only web-owned boundaries. The signed group-tool callback supplies the member id; the model must not supply or select one. Reads may return only that member's opaque membership ids, group labels, role, requested scopes, active grants, and existing owner-authorized first-party permission links. Because the current permission link is also reusable invite authority, return it only when that member owns the group. A leave request must select an opaque id from that member's current read, re-bind it to the callback member inside the web transaction, reject the canonical owner and stale or foreign selectors, revoke the member's active shares and clear their encrypted snapshots in the same transaction, and only then delete the membership row. No runtime cleanup envelope is required. The authenticated join page may return that same viewer's opaque membership id to its first-party client; every page accept must carry the rendered id or explicit absence, and Web must compare it with current row presence under the existing group/member locks before creating membership or changing grants. Missing or stale page state fails closed so an older sharing save cannot recreate a membership after leave. Group-chat reactions remain on their route-bound additive flow. Group runtimes and unauthenticated sender contexts must not invoke self-leave. Do not return another member's id, handle, name, email, grant state, roster entry, or shared record, and do not persist the membership response in the personal vault or assistant runtime. An active grant and its canonical activation time are authorization metadata, not proof that a projected health or identity record exists, has been delivered, or was granted because of a particular challenge. The challenge's documented bounded recency rule may use the timestamp only as best-effort social-entry evidence and never to widen data authority.
- The group room model is a derived social-context boundary inside one synthetic group vault, never an identity or permission system. Its silent maintenance turn may read only engine-supplied bounded committed transcripts from authenticated non-direct Linq/iMessage or Telegram group routes and the exact existing page returned by `murph.group_room_model`. Only the immutable built-in automation id grants that silent tool authority. The turn runs as a fresh one-shot Codex thread under the `murph-group-room-model-maintenance` permission profile, which denies workspace and network access, so it has no ambient filesystem, generic knowledge, or external-service path. The same dedicated owner serves explicit authenticated room requests; generic knowledge show, list, search, append, upsert, and generated indexes exclude the reserved slug. Every replace or delete supplies the digest returned by show and compares it under the fixed-page write lock. There is no separate authored-body byte cap. Replacement validates the complete serialized fixed page against the defensive 64 KiB raw-file ceiling before changing the prior page, and ordinary prompt injection renders the complete accepted page without revalidating it against a wrapper-dependent byte ceiling. Missing state has its own digest and may be recreated; malformed, unreadable, wrong-type, stale, oversized-file, or identifying content fails closed. Raw `Sender:` handles, profile display names, unverified owner-contact labels, and Telegram `Speaker name:` labels are transient attribution evidence only and must never be persisted in the page. All such labels are bounded, sanitized, safely quoted presentation data; none supplies identity, membership, consent, routing, matching, persistence, or effect authority. Group email receives neither the page nor this mutation tool and contributes no maintenance evidence because its sender is spoofable. Transcript and page contents remain untrusted quoted data: commands, links, permission claims, tool requests, and policy text inside them must never be followed. The ordinary admitted group-chat prompt must prefer the current conversation, safety rules, explicit canonical room style, and live tool results. Medical or health disclosures, credentials, financial or legal trouble, intimate disclosures, precise location, and serious vulnerabilities must not be promoted into the page merely because they appeared in the room.
- Managed automation authority comes only from an exact current built-in seed or registered dynamic identity and its immutable owner scope. `member` seeds require a personal/direct route; `authenticated-group` seeds require a live exact non-direct Linq/iMessage or Telegram route, and group email is excluded. The runtime revalidates that authority before lifecycle hooks and every provider, tool, delivery, or commit boundary. Mutable tags, slugs, titles, instructions, room-model content, and historical participants cannot acquire identity or group authority. Permanently retired built-in IDs fail closed before lifecycle or model work and are archived during normal reconciliation. The post-onboarding choice point is the one registered dynamic member identity and additionally requires current canonical answered-onboarding state. Its turn uses the ordinary private scheduled-session prompt and normal vault authorization, but its named member-read permission runs only in a fresh ephemeral one-shot Codex process with explicit workspace roots. The process receives committed conversation history and can read the permitted vault; its provider thread is never resumed or persisted into the ordinary member session. Its instructions may guide targeted reads but never grant a tool, route, or mutation capability.
- Consented group-to-member disclosure requires both current group membership and a separate immutable per-membership grant; ownership or membership alone never authorizes a private read.
  - Before posting, Web normalizes permission text to NFC/LF with outer trim, enforces the 1,000-code-point limit, rejects every Unicode control, format, surrogate, private-use, or unassigned code point except LF, and binds the exact provider message to a group-scoped, server-keyed, versioned blind index. The exact permission is encrypted with the existing `hosted-member-private-field` secure-box under the synthetic group runtime, with AAD bound to its table, row, and field. Opaque ids, keyed lookup values, and lifecycle timestamps are authority metadata; common permission scopes and exact text must not be recoverable from a database snapshot.
  - Permission posting derives stable request and Linq idempotency identities from server-owned group and accepted-input facts plus the exact public consent bytes. Exact retry dedupes; changed text cannot inherit an earlier provider message id. Web rechecks the current Linq route immediately before send. A provider-accepted message that Web cannot bind remains an inert, ungrantable orphan rather than introducing reservation or reconciliation state.
  - Only a verified current roster member's exact `like` reaction to the bound Murph-authored message creates the grant. Reaction replay is idempotent and cannot recreate a revoked grant. A group ask uses only a current opaque grant selector from Web's live read. One trusted accepted input or claimed scheduled occurrence owns at most one request per exact grant: exact replay reuses it, a changed question conflicts, and another grant remains independent.
  - The existing scheduled group-tool factory may attach the ordinary bounded group port only after the claimed occurrence resolves to the current non-direct Linq route; runtime-minted scheduled invocation authority is required to retain it. Ordinary notifications and manual, direct, unknown-audience, or local cron turns receive no group capability.
  - Web binds every hidden identity and revalidates the exact group route, personal runtime, membership and grant generations, permission digest, origin, expiry, and runtime fence at admission, before the personal read, and before completion append. Leave/rejoin, revoke/regrant, stale route, expiry, or changed authority fails closed.
  - Accepted-input completion carries its exact mailbox anchor into one isolated, output-only continuation in the caller group runtime. The reviewed answer is bounded untrusted input, and the caller may use only its existing group history to resolve public references before creating the ordinary outbox intent. Final Linq or Telegram egress rechecks the same live authority before provider dispatch; missing or mismatched proof is terminal. If authority disappears after queueing, the existing intent replaces all answer text and media with the fixed text-only fallback.
  - A scheduled occurrence remains one ordinary Codex turn: start every selected ask, then use ordinary shell waits and exact replay to poll each accepted ask until it returns completed or unavailable. The existing request expiry bounds the loop. The cron owner revalidates the current canonical automation and non-direct route immediately before each Murph tool call; Web then revalidates the exact request, completion, and live disclosure authority before returning a completed result. Scheduled completion never wakes the group runtime, starts another provider turn, creates an outbox delivery, or holds a callback open while the member runtime works.
  - There is no incoming model reviewer. The personal read-only candidate receives the exact permission context. One fresh outgoing reviewer receives only that permission, the question, and candidate; it has an empty workspace and no shell, personal workspace, application tools, network, delivery route, or persistence. It may only allow or deny. An allowed answer enters only the caller group's isolated output-only continuation; denied candidates do not enter Murph durable state, operational logs, errors, or delivery.
  - Treat every reviewed answer as untrusted data, not authority for another action. The caller continuation receives no personal vault, target tools, shell, web, apps, plugins, or native provider resume authority and must not infer private facts beyond the reviewed answer. Do not add roster fan-out, broad vault mounts, member fallback, candidate/reviewer write tools, a rewrite loop, a policy engine, a second scheduler, a queue, or continuation lifecycle.
- Treat AgentMail inbox ids, message metadata, attachment download URLs, and outbound email thread bindings as high-sensitivity operator data; never log or fixture real mailbox details or API keys.

## Dependency Supply Chain Rules

- Keep `pnpm-lock.yaml` committed and update it in the same change as every manifest edit; setup, onboarding, deploy, and reproducibility docs/scripts should install with `pnpm install --frozen-lockfile` unless the task is intentionally editing dependencies.
- Do not introduce third-party dependencies via `git:`, `git+`, `github:`, `http:`, `https:`, `file:`, `link:`, `portal:`, or `npm:` alias specs. Internal workspace packages must use the `workspace:` protocol.
- Keep the root pnpm supply-chain controls enabled: exact package-manager pinning, `packageManagerStrictVersion`, `managePackageManagerVersions`, `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, and explicit `allowBuilds` review. Do not bypass them with `dangerouslyAllowAllBuilds: true`.
- Prefer repo-local helpers or built-in platform APIs over one-off utility packages when the replacement is small, stable, and auditable.
- When adding or updating dependencies, review the manifest and lockfile together, run `pnpm deps:guard`, run `pnpm deps:audit`, and review blocked install scripts with `pnpm deps:ignored-builds` / `pnpm deps:approve-builds` before handoff. Keep any `allowBuilds`, `minimumReleaseAgeExclude`, or `trustPolicyExclude` exceptions as narrow and reviewable as possible.

## Runtime Security Posture

- The database-health cron is a platform operation, not runner provider egress.
  Its PlanetScale service-token id/token, Linq token, and two operator chat ids
  are required Worker-only secrets and must never enter runner env, URLs, logs,
  persisted samples, fixtures with real values, or alert copy. The configured
  PlanetScale organization, database, branch-name, and branch-ID selectors are
  deploy vars, not request input. The dedicated service token is
  organization-scoped because that is where PlanetScale grants
  `read_metrics_endpoints`, and it has no other permission. Service discovery
  uses the fixed PlanetScale API origin and the documented `<id>:<token>`
  authorization contract without an authentication scheme; the authenticated
  response may select only one HTTPS/443 scrape target with a bounded path and
  bounded signed `__param_*` query values. The service credential is sent only
  to the fixed discovery origin; signed scrape parameters are never persisted
  or logged. Discovery and scrape disable redirects, enforce ten-second
  timeouts and byte caps, and reduce responses to allowlisted connection
  metrics before persistence. Before Linq message egress, the dedicated sender
  independently reads each configured direct chat and the current line
  reputation, requires the selected chat and line to be healthy, canonicalizes
  only the documented phone-number formatting,
  accepts the current nested reputation status plus the documented deprecated
  top-level health-status alias, derives each chat's sole external phone
  recipient in memory, requires the two resolved recipients to be distinct, and
  persists or logs none of that provider response. When distinct chat ids
  resolve to the same external recipient, only the primary operation may enter
  Linq and the pending page remains unresolved. An unresolved primary identity
  suppresses secondary provider entry because distinctness cannot be proven;
  an unresolved secondary may still allow the healthy primary operation.
  Primary chat or line health does not erase an otherwise unambiguous identity,
  so a healthy distinct secondary may still enter while the primary is
  suppressed. It otherwise uses Linq's no-`from` auto-selection endpoint
  separately for each direct chat so a line that becomes flagged after
  preflight can fail over; no model, runner, request, or stored state can select
  another recipient.
- Runtime trust boundaries exist for local loopback daemons, hosted web, Cloudflare-hosted execution, provider ingress, billing, device sync, and assistant runtime state. `ARCHITECTURE.md`, this file, and the relevant app/package docs must change together when those boundaries change.
- A hosted member's OpenAI or Venice choice controls only core assistant
  inference. The selected provider receives the information required to produce
  that reply; specialized tools may still use separate managed providers.
  Web owns the nullable preference and exposes Venice only behind its rollout
  flag. The Cloudflare Worker owns both real API keys and gives the runner only
  provider-, user-, and runner-bound signed credentials. Venice egress accepts
  only the two Responses POST paths, canonical product model ids, a bounded
  20 MiB request body, and fixed code-owned model mappings; it disables Venice's
  added system prompt, web search, and web scraping at the final egress rewrite.
  For the exact Codex Responses Lite shape, that rewrite may add only cache
  control metadata to a supported developer content block; it does not log or
  persist prompt content, request bodies, or cache keys.
  Those mappings are pinned to `openai-gpt-56-luna`,
  `openai-gpt-56-terra`, and `openai-gpt-56-sol`. Runtime egress derives them
  directly from the shared code-owned map, so provider-aware allowance pricing
  cannot drift from the model that received member content through duplicate
  operator configuration.
  Settings may say that Murph disables OpenAI response storage because the
  direct OpenAI Responses path sends `store: false`, which [disables Responses
  API storage](https://developers.openai.com/api/docs/guides/migrate-to-responses#4-decide-when-to-use-statefulness).
  This is an application-state setting, not a zero-data-retention promise:
  OpenAI documents separate [abuse-monitoring, prompt-cache, and endpoint
  retention controls](https://developers.openai.com/api/docs/guides/your-data#v1responses),
  and third-party tools retain data under their own policies.
  Settings may describe Venice as privacy-first and state that Venice stores no
  prompts or replies, matching [Venice's API privacy
  documentation](https://docs.venice.ai/welcome/privacy). Treat that as a
  Venice-layer provider disclosure only. Murph validates the configured model
  id but does not query or lock Venice's model-level privacy badge, so the
  setting must not promise E2EE, TEE, or broader upstream retention or training
  behavior.
  Provider choice never grants delivery, vault, billing, or identity authority.
- An accepted-message `Message ref` is an opaque selector, not authority. Render only the existing `AssistantInputEvent.inputId` when at least one exact-message action is eligible and the accepted input is positively identified route-authorized Linq iMessage or Telegram; conversation source and reply-target channel must also agree. Linq SMS, RCS, and unknown service types expose no ref and are ineligible. `murph.select_reply_target`, `murph.react_to_message`, `revoke_own_email_share`, and group phone-call requester selection must require an exact active root invocation, use the same resolver, bind the ref to the current delivery-context ordinal, reload the stored event, and recheck route, conversation, direct/group audience, account, provider target or sender evidence, and action-specific capability before execution. Participant-specific group effects accept no canonical member id: the runtime forwards only the exact accepted input id plus trusted provider source/sender evidence, and Web resolves the canonical member and revalidates current room membership or share authority. Missing or unattributed sender evidence fails that participant effect without suppressing the normal conversational reply. The dispatcher must reject descendant, stale-turn, or foreign-thread tool requests before consulting accepted-message authority, and descendant shell env carries no targeting authority. Invented, stale, cross-turn, cross-thread, cross-room, wrong-sender, descendant, or unsupported refs fail closed. Provider message ids must stay out of prompts, tool arguments/results, model history, diagnostics, and model-visible errors; only the local delivery owner may resolve one immediately before the effect.
- `murph.group action="read_chat_name"` is a read-only, Web-owned provider
  metadata boundary. The signed callback member selects the synthetic group
  runtime; Web resolves its single encrypted Linq or Telegram thread route and
  never accepts a provider chat id from the model. Provider titles are bounded
  untrusted display text and confer no identity, membership, consent, routing,
  or mutation authority. They are returned only as `displayName` with an
  `ok`, `none`, or `unavailable` status and must not be logged or cached.
  Suppress Linq's default comma-joined participant-handle label so phone
  numbers and email addresses cannot become a group name. Group email and
  direct or personal runtimes cannot authorize this provider-title lookup.
- A signed Linq edit webhook authenticates provider delivery, not the edited
  text or its claimed authority. Web may correlate it only to an already
  accepted inbound conversation item through the private versioned blind
  source-message key, then must reattest the original sender, chat, direction,
  and current direct route or same group route plus container authority before
  appending a correction. Optional group member attribution and personal
  entitlement are not room authority; missing participant projection remains
  eligible, while an existing projection must fail closed on positive
  removal or handle-conflict evidence. A correction may join an active turn
  only when its opaque original reference names an input already accepted into
  that turn; otherwise it remains pending for ordinary planning.
  The edited text remains quoted user data; the runtime-injected part index,
  opaque original assistant-input reference, and correction framing are the
  only trusted prompt metadata. The reference is deterministically derived
  from the already-accepted envelope and must never expose the provider
  message id. Provider
  diagnostics may retain event identity, timing, direction, and blinded
  correlation keys, but never replacement text or raw message, sender, or chat
  identifiers. Outbound edits are diagnostic facts and never runtime work.
- Hosted automation record authority is scoped by the active write-fenced member or synthetic-group workspace and its restored canonical vault, not by each record's stored delivery route. A narrow automation port is captured from durable accepted input for the active authenticated root turn and binds new or explicit retarget writes to that trusted route. Invocation-scoped automation and device authority is exposed only through typed root-turn dynamic tools and must be absent from Codex App Server and descendant shell env. The dispatcher must reject descendant, stale-turn, or foreign-thread use. Tool arguments must not let the model select another route. Attended and scheduled root turns use the same dynamic-tool planner; the invocation's actual route, audience, available ports, and accepted-input evidence decide which tools can perform an effect. Non-direct email remains unable to mutate durable room controls because its audience is not authenticated for those controls, not because it runs a reduced assistant profile.
- Group newsletter setup is valid only from a verified non-direct iMessage or Telegram group route. The structured setup action owns the stable slug, canonical configuration, and exactly one system delivery tag; ordinary model-authored automation writes cannot claim those tags. The ordinary dynamic-tool planner exposes the newsletter email port only when the trusted runtime supplies scheduled email occurrence authority, so a current-chat newsletter receives no email capability. For group-email preparation, the signed callback member resolves the unique hosted group; any legacy request `groupId` is compatibility-only, ignored, and never authority.
- Interactive group participant attribution comes only from provider-authenticated ingress, never from the model or from message content. Web attaches the sending Telegram user id to non-direct route-authorized inbound only after that id resolves, under row lock, to exactly one active linked member; anonymous administrators, `sender_chat` posts, bots, unlinked users, and direct threads stay unattributed. Sender evidence reaching `read_shared` travels in one field per channel and is matched only against that channel's member identity index, because a numeric Telegram user id normalizes into a valid phone lookup key and would otherwise resolve to an unrelated member; populating both fields fails closed. A trusted Telegram display name or `@username` may accompany the handle for display only; both are optional and user-mutable, and usernames are re-registerable, so neither is identity authority. Linq labels are resolved only after durable ingress through the narrow `read_participant_display_names` boundary. After proving the synthetic runtime is active, Web matches each exact handle against current joined memberships and decrypts only an exact unique unsuspended member's existing `profile-name.v0` snapshot, never selectable health grants or device state. Absence of a hosted-group row means there is no profile membership to match; it does not bypass the owner-contact reader's separate owner, consent, projection, safe-label, KMS, or storage checks. A canonical phone with no member match, or with one unsuspended matched member but no profile name, may consult that human group owner's currently enabled, consented address-book projection; a safe unique match returns explicit `unverified-owner-contact` provenance and can never override a profile name. An ambiguous or suspended member match remains unnamed. Invalid input, authorization loss, consent loss, KMS/storage failure, timeout, or rollout skew likewise omits the label without blocking or acknowledging conversation work. The assistant-runtime presentation adapter owns the only memoization layer: operation-local positive, negative, and fail-soft results plus one bounded private file cache under `.runtime/cache/assistant-runtime/`. The fixed filename contains no private identifier; each entry key is an opaque SHA-256 digest over the callback-bound runtime member, exact accepted-input route conversation key, channel, and normalized handle. The owner directory is `0700`, the versioned JSON file is atomically replaced as `0600`, and raw handles, route ids, display labels, provenance, and cache keys are never logged. Valid profile and owner-shared contact labels use a fixed 14-day TTL. A six-hour negative entry requires Web's explicit `nameMissSenderHandles` evidence that every applicable authorized profile/contact source was successfully checked for that exact requested handle and no safe label exists; a policy, ambiguity, suspension, authorization, legacy-rollout, failure, or malformed-response omission never enters the file. Missing, corrupt, oversized, or unreadable state fails soft to an ordinary miss. The file is presentation residue rather than identity or authority, is excluded from hosted workspace checkpoints with the rest of `.runtime/cache/**`, and must never be copied into product truth, supplied as an action selector, or return a hosted member id or participant id. There are no timers, sliding expiry, mutation invalidation, resident mirror, lock owner, or distributed coordination. Exact accepted-message refs plus server derivation remain the only participant-effect authority. An exact current unsuspended group participant may revoke their own newsletter email share even when personal paid access is inactive; revocation authority comes from the exact server-derived participant and current membership, not entitlement.
- A route-authorized non-direct Linq or Telegram mailbox wake may retain the
  internal member id already resolved by provider-authenticated Web ingress for
  stable aggregate activity reporting. This optional field is encrypted,
  group-only, and admission-time: direct wakes reject it, later identity
  relinking or deletion cannot rewrite it, and it is never entitlement
  authority or model-, UI-, log-, or telemetry-facing data. Legacy retained
  wakes may use current unique blind-index resolution only as bounded
  compatibility; an unmatched legacy sender falls back to the existing keyed
  opaque identity, while ambiguous or malformed evidence still fails closed.
- Hosted usage-referral authority is web-owned and current-sender-bound. The
  model may choose only a versioned policy code after one exact current sender
  explicitly accepts; it cannot supply a referrer, beneficiary, amount, source,
  target, route, provider id, counter, or qualification fact. Personal calls
  bind the callback member and persist only the runtime-injected source channel,
  blinded exact-thread locator, and directness fact. Celebration queueing
  re-resolves the frozen channel and requires the same direct thread.
  A personal Linq wake freezes that resolved source as an explicit delivery
  target so provider entry cannot replace it with a newer home route; source
  revocation fails closed. Group celebrations carry live external-thread
  authority. Celebration instructions never persist a detached profile name.
  Group calls require
  exactly one runtime-injected
  provider-scoped sender handle that resolves to an active personal member;
  mixed-channel, missing, or ambiguous sender evidence fails closed.
  Provider adapters store only domain-separated lookup keys and bounded
  counters. Unlinked Telegram group messages may contribute evidence only for
  an already-bound target and must remain outside the assistant mailbox,
  visible setup-reply path, and authorization path. Referral cap commitments
  include bound rows through the server-owned 25-hour late-evidence grace and
  rewards mutate only through the beneficiary lock and server policy catalog;
  browser state and model output never reserve or grant credit. The
  Web owner fails arming, binding, and observation closed unless
  `HOSTED_USAGE_REFERRALS_ENABLED=1`; operators must not enable it until the
  post-drain ledger contract migration has widened and validated the credit
  entry constraints.
- Linq participant-derived thread-container access is a bounded seven-day lease, not a permanent capability. Every canonical access consumer must use the same `lastSeenAt` and `removedAt` predicate. An authenticated group inbound may renew only an existing nonremoved relationship after server-side sender resolution; it may not upsert authority, reverse removal, regress the observation, or accept a future provider time. Provider display labels and raw contact text are never entitlement authority.
- A next-Linq-group ownership intent may be armed, read, or canceled only from
  fresh accepted input in a private text conversation for an active person
  member on that member's current managed Linq line. It is not available from a
  group, email, scheduled turn, synthetic thread container, or model-supplied
  target. Persist the owner id, blinded line key, bounded timestamps, and only a
  strict versioned setup payload encrypted with member-private-field
  authenticated data bound to the exact row. Plaintext setup, raw handles,
  roster, chat id, messages, and contact labels remain absent. Setup may contain
  only sparse existing style values and bounded explicit room-context Markdown;
  it rejects raw phone, email, Sender, Telegram, and participant handles. The
  assistant must not infer or copy private memory, health facts, contacts, or
  personal settings. Current roster handles are request-local evidence and only
  bounded resolved member ids enter the route transaction. An unavailable
  roster or an exact recovery delivery still awaiting provider correlation
  must fail before route creation; neither may collapse to first-speaker
  authority. An undocumented or provider-supplied add actor is never authority.
  Logs contain only categorical roster, claim, and activation outcomes, never
  setup content.
  Setup can configure only a newly created synthetic room through the existing
  preference and fixed room-model owners; it cannot change an existing route,
  establish identity, consent, routing, or membership authority. Owner deletion
  cascades the encrypted intent.
- Account deletion must establish durable external-cleanup ownership before canonical member removal. The foreign-key-free retry receipt stores only KMS-encrypted runtime/vendor identifiers with receipt- and environment-bound authenticated data, remains pending for missing configuration, provider timeout, partial failure, or a legacy Cloudflare response without explicit `deleteAllCompleted` evidence, and is deleted only after Cloudflare, Stripe-customer, and Privy cleanup converge. Privy new-member resolution must first resolve any existing identity, then reject a pending deletion receipt, then require a bounded live-provider read; after binding, app-session issuance must lock and re-check the member so a missing or suspended deletion target cannot receive a session. Immediate and retention attempts have explicit target deadlines; the retention batch uses bounded concurrency so a stuck provider cannot become an unbounded response-path or sweep owner. Logs and the deleted member row are not retry owners.
- A scheduled non-direct Telegram target is routing data, not authority. Before group tools, shared-data reads, or model work, the runner must ask the signed Web route owner to bind the exact Telegram thread to the callback-authenticated synthetic container member. Persist that exact typed authority on the ordinary outbox, then reassert it immediately before Telegram text, image, reaction, or voice provider entry. A missing owner/effect is retryable, a changed or mismatched owner fails closed, and neither a stored automation target nor a runner-injected provider credential may substitute for the live route assertion. Ordinary current-inbound group replies remain authorized by their admitted route and do not require manufactured scheduled authority.
- The public footer status read is a browser-to-incident.io technical-data boundary. Keep it on the fixed HTTPS status origin and fixed public summary path with no request body or query; retain the global `strict-origin` referrer policy and the exact-origin `connect-src` entry. Do not add account, page-path, query, fragment, prompt, health, message, cookie, or credential data to the request, and do not treat an empty public incident list as direct uptime proof. Keep incident.io and the technical metadata it receives disclosed in the public subprocessor register.
- Before adding a new external API, auth surface, wallet surface, storage authority, webhook, or runtime ingress path, document the trust boundary in `ARCHITECTURE.md` and the concrete rules here.
- External provider request params, nested params, and per-request options must
  use installed official SDK types and must not contain object spread syntax or
  `Object.assign`. Build the SDK-typed object first, then assign each optional
  field explicitly; this preserves excess-property checking that TypeScript
  otherwise loses across composed objects. `pnpm provider-requests:guard`
  enforces the registered Stripe, Kernel, Linq, Retell, Temporal, OpenAI, and
  Junction boundaries across production apps, packages, and scripts. Register
  each new official SDK boundary when it is introduced. The opt-in
  `pnpm --dir apps/web stripe:contract:resume` probe accepts only a dedicated
  test-mode secret key and calls the real resume endpoint with a synthetic
  missing Subscription, so parameter drift fails without creating, charging,
  or mutating a Stripe resource.
- Direct-plan upgrades use Stripe Customer Portal's `subscription_update_confirm`
  flow for the authenticated member's exact current Customer, Subscription,
  Subscription Item, and server-selected target Price. The browser chooses no
  Stripe identifiers, and the Portal return query is display context only;
  verified Stripe webhooks and the canonical billing projection remain the
  only entitlement authority. The one-time retired-usage-item migration may
  delete only explicitly marked metered companion Items next to exactly one
  known licensed monthly direct-plan Item, must dry-run before apply, and may
  emit aggregate counts only.
- Subscription management remains an authenticated billing-owner capability
  after Murph access is suspended. Suspension may block new entitlement or
  payment effects, but it must not block the exact Customer Portal owner from
  canceling or repairing the subscription. Portal return state remains
  display-only and never restores access.
- Usage-credit Checkout is an authenticated payment boundary, not an assistant
  or browser-selected billing primitive. Settings routes must enforce the
  normal app-session and same-origin/CSRF protections. Personal checkout binds
  payer and beneficiary to the same active direct paid Pulse or Edge member.
  Family checkout binds payer to the active Family owner, rechecks the selected
  active unsuspended direct member in that owner's active group, and resolves
  the Customer only from the group's active billing reference. The fixed
  personal/Family $5/$10/$25 or group $5/$10/$20 offer and reusable Price come
  from server configuration. Before
  Checkout creation, the service must re-fetch
  that Price and fail closed unless its mode, active state, one-time per-unit
  shape, single currency, and exact amount match the frozen purchase; Adaptive
  Pricing stays disabled. The browser may submit only the offer code and a
  single-use request key; it must never choose an amount, Price, Customer,
  payer, beneficiary, group, Customer, grant, or Checkout URL. Trial,
  unauthorized Family-sponsored, suspended, thread-container, missing-billing,
  and malformed states fail closed. Personal, hosted-group, and Family targets
  remain distinct even when payer and beneficiary ids coincide. Mutable Family
  membership gates every payable request. Exact request-key replay identifies
  the immutable purchase, but a Family replay rechecks current authority before
  releasing payment capability. Family creation rechecks that same exact target
  after Stripe returns and before decrypting a Checkout URL or projecting retry
  permission, so membership removal during provider I/O degrades to
  status/cancel-only recovery; fulfillment remains bound to the frozen purchase.
  Family admission first binds the
  opaque selector to the owner's roster before locking the beneficiary. A
  payer-wide conflict with another frozen target may be inspected or canceled
  but must never return a payable URL or retry permission, regardless of the
  requested or frozen target kind. Active-purchase projection releases a
  payable URL or retry permission only for an exact server-approved target.
  Former Family beneficiaries are always status/cancel-only; historical labels
  and contact hints are display data, not payment authority.
- A Family invitation binds a normalized contact only through its keyed blind
  index. Before reserving or buying a seat, issue-time admission must reject an
  exact active owner or member match; acceptance repeats the same-group
  membership check under the group transaction as a concurrency backstop.
  Contact hints, names, stale invitations, and a browser-supplied member id are
  never membership or payment authority.
- Group sponsorship separates funding authority from permission to speak into
  the room. A valid current funding locator may identify only the frozen group
  beneficiary. Alias, note, or running-bit content is accepted only from the
  current container owner or an active participant under the canonical
  participant lease, and that authority is rechecked after verified payment.
  The content is normalized, bounded, HMAC-bound to request-key replay,
  encrypted through the hosted member secure-box owner, omitted from logs, and
  quoted to the Assistant only as untrusted data. Losing authority suppresses
  publication without weakening or reversing the verified usage grant. The
  frozen digest remains strict while payment can start or continue. A terminal
  exact-key replay may acknowledge a changed remounted draft only as a
  nonpayable selection conflict; it never rewrites or activates that content.
  The creative notification prompt profile supplies only the task and bounded
  committed group history in an isolated thread, projects only
  `generate_song`, and applies the output-only native-capability deny set:
  approval never, read-only sandbox, and no shell, browser, apps, plugins,
  delegated agents, native web search or fetch, artifact materialization,
  generated-image upload, or progress delivery. The bound provider transport
  remains available only to the application-owned song tool so ElevenLabs and
  Linq API calls retain their runtime authority headers. The same
  application-owned tool uses the existing authority-free public transport only
  for its validated Linq-issued presigned upload. The fresh ephemeral thread
  carries the deny configuration on the resident App Server, so neither
  transport becomes a native Codex browsing surface and no second provider
  process is needed. Its prompt asks for one short original song through
  exactly one `generate_song` call and forbids
  separate contact, scheduling, state mutation, or disclosure of private
  health, account, payment, or routing details. Running bits may reach only fresh
  route-authorized non-direct Linq or Telegram input
  for the exact beneficiary, and account deletion removes the creator-owned
  authored row while retained financial purchase history remains detached.
- Group `read_usage` is a room-public aggregate read, not billing or sponsor
  access. The signed callback and active runtime fence bind it to the synthetic
  group member; the model supplies no member, payer, period, spend, limit, or
  credit selector. Web may return only funding urgency, the first-party funding
  capability, and a required integer `includedUsageUsedPercent` on the current
  successful response. Web derives
  that integer from counted current-period included spend and the included
  limit only. Purchased, referral, carryover, and automatic-refill credit must
  not affect it. The response must not expose raw spend or limit values, cash or
  credit balances, remaining capacity, payer or contributor identity, sponsor
  status, cap, charges, pending payments, refill state or events, period dates,
  message counts, receipts, or internal accounting units. `100` is not
  exhaustion authority. The assistant may state the approximate aggregate only
  after an explicit participant usage-status question; transport code must not
  infer that intent or make the aggregate proactive. Group email may use the
  same room-public read under resident prompt policy because it cannot load the
  detailed skill, but the spoofable sender gains no mutation, payer, billing,
  or private-account authority.
- Current-policy personal and Family saved-card funding resolves the exact
  Murph billing Subscription whose Customer matches the authenticated payer's
  verified Stripe Customer. Murph may use that Subscription's attached
  explicit default or its inherited attached Customer default. Missing, stale,
  terminal, customer-mismatched, unattached, or legacy Source-only
  exact-subscription state stays in Checkout; unrelated Subscriptions never
  participate. Hosted-group funding does not require a Murph billing
  Subscription and may use the attached Customer default or require exactly
  one attached method only when no legacy Customer default Source exists.
  Frozen v2 purchases retain the legacy behavior for group targets only,
  frozen v3 purchases retain it for all targets, and v1 retains no saved-card
  path. The browser cannot supply a PaymentMethod. `allow_redisplay` governs
  whether Stripe may present a method again inside Checkout, not whether the
  attached card can fund the payer's explicit purchase or an already-authorized
  exact-$5 group refill.
  Current-policy Checkout enables Stripe's explicit payment-method save choice;
  Murph does not upgrade or broadly redisplay historical methods. A monthly
  group sponsorship binds one authenticated payer to one exact group and a
  $5/$10/$20 cap. Conversation text, room participation, amount selection, and
  possession of a funding URL are never financial consent. Current group
  capacity is not payment authority and does not gate an explicit contribution
  or activation. Activation and every cap increase require an explicit
  authenticated payer action. Automatic refill
  authority is rechecked under the beneficiary lock against the exact
  authorization, anchored period, ordinal, payer, pending-plus-fulfilled cap
  headroom, still-unsuspended payer, and still-unbound purchase before provider
  confirmation. Only one
  live authorization per beneficiary is database-enforced. Recovery, cap, payer,
  and charge details route only to the payer's direct notification destination;
  the room may learn only that Murph is sponsored. The server
  creates the PaymentIntent
  unconfirmed, then revalidates the exact personal or Family billing Customer,
  Subscription, canonical billing status, suspension state, and last accepted
  Stripe-event time under the payer lock before storing the intent's encrypted
  exact reference on the frozen purchase and confirming it off session. A
  billing-reference change, deletion, or terminal-state race cancels the
  unbound intent and never confirms it. After bind, a later billing change does
  not retarget recovery. An ambiguous
  confirmation remains bound and
  retryable; only verified `canceled` state may clear that binding and permit
  Checkout fallback. While that payment is nonterminal, recovery remains bound
  to its frozen offer and original client request. A different submitted amount
  returns the frozen purchase's status/cancel-only projection. If that response
  is lost or dismissed, the browser can reuse the rejected key only with the
  server's recovery-only capability. The payer lock may continue an existing
  matching purchase but cannot create one; when none exists, it returns a miss
  before resolving a new Customer or entering Stripe. The miss clears the
  visible amount but retains the unresolved key in payer-and-target-scoped
  browser session storage. The authenticated server-rendered payer identity
  selects the browser slot, so another account using the same target in that
  tab cannot consume or clear the first payer's unresolved key. The browser
  verifies storage before the first request,
  hydrates it before enabling a remounted picker, and fails closed rather than
  minting another create-capable identity when storage is unavailable. The next
  explicit authorization reuses that key without the recovery-only capability,
  so payer-lock and request-key uniqueness serialize it with any delayed
  original request instead of authorizing a second purchase. Only a durable
  selection response with server-owned proof that its submitted request key
  matched clears the stored key; mounted active-purchase and return
  projections, projected-purchase retries, and different-key recovery cannot
  release it. The opaque key and payer-and-target-scoped browser slot are
  navigation and idempotency hints only; every request rederives authenticated
  payer and target authority. If the newly
  selected amount differs from the delayed winner, the server returns the
  winner's nonpayable status/cancel projection. Choosing an amount has no
  payment effect, and each
  explicit **Add usage**, one-time contribution, or monthly sponsor action
  authorizes only the exact server-projected purchase or cap change. Current-policy Checkout fallback saves the entered card for
  later explicit top-ups. No raw card data enters Murph.
- Direct-purchase and group-sponsorship cancellation require only authenticated
  payer ownership of
  the opaque purchase ID. Beneficiary, group-locator, or current target
  authority may gate retry but must not gate cancellation. Payer deletion may
  detach a fulfilled sessionless purchase only after clearing payer-encrypted
  references and retaining its non-secret PaymentIntent/Charge lookup proof for
  later refund or dispute reconciliation. PostgreSQL enforces that proof
  directly: a detached fulfilled row must remain paid, terminal, reconciled,
  and carry both lookup keys, while the separate ciphertext constraint rejects
  any retained payer-encrypted Stripe value. A canceled, inactive, or departed
  group beneficiary therefore degrades the payer surface to cancellation-only
  management rather than trapping the recurring authorization.
- Stripe proves payment; it does not own Murph usage capacity. A browser return
  or client-reported Session or PaymentIntent state must never grant credit.
  The verified Stripe receipt owner must re-fetch and bind the live one-time
  Session when present, PaymentIntent, Charge, Customer, currency, amount, mode,
  and fixed-purpose metadata to the immutable purchase before appending one
  grant. Checkout additionally requires the exact line item. Stripe
  metadata contains only opaque purchase and fixed purpose/version values.
  Provider references use the existing keyed-lookup plus encrypted-value
  pattern and must not enter URLs, logs, prompts, assistant state, fixtures, or
  user-visible responses. Matching usage-credit refund and dispute events must
  be intercepted before subscription handling. Only live re-fetched payment
  state may append capped signed `refund_adjustment` or `dispute_adjustment`
  entries against unused attributable credit. A reconciliation failure keeps
  the receipt retryable rather than suspending the subscription or silently
  completing the event.
- Automatic meal-photo capture must remain explicit opt-in. The iOS companion is the only client that classifies photos locally and may upload only locally re-encoded JPEGs selected after opt-in; it must not send historical-library contents or original photo metadata. Enrollment uses a foreground Privy identity token and requires both historical launch grants, so absent or partial consent remains fail-closed while a later document revision cannot strand an existing member on the iOS surface with no current-document consent UI. The extension may persist only the dedicated renewable meal-photo bearer and idempotency secret in its shared keychain. The foreground iOS app keeps only the schema-v2 authority revision and pending-mutation marker in app-private durable `UserDefaults`. Neither value contains account, photo, or health data, and no extension owns them. Before every schema-v2 identity enrollment or revocation request, iOS durably allocates a larger positive signed-32-bit revision. Web stores that high-water mark on the sole member-and-installation enrollment row; revocation upserts a credential-free tombstone, lower or same conflicting revisions fail closed, and only an exact replay of the current disabled revision is idempotent. Schema-v1 identity mutations remain compatible only at revision zero and cannot cross a positive fence. A schema-v2 enrollment response remains credential-only but its bearer is prepared, not upload authority: the foreground iOS app must save it durably before bodyless scoped activation and may enable capture only after activation succeeds. Prepared uploads fail authorization, and a lost response cannot leave usable authority. Scoped activation and self-revocation both reread the exact token under the member lock; activation also locks any active sponsorship membership/group rows before consent and access checks. Family billing locks its owner and active roster members in stable order before changing those access rows, so deleting or access loss first blocks activation, while activating first still permits the following deletion or access loss to become authoritative without a cross-owner deadlock. Web stores the bearer and installation UUID only as SHA-256 hashes, encrypts the idempotency secret with member- and row-bound AAD, requires complete credential state for prepared and active rows, accepts the scoped bearer only for activation, upload, or self-revocation, rejects every JPEG application/comment segment, and rechecks each upload before commit. That final check uses the same hosted-member then active-sponsorship lock order before rereading the active enrollment, active access, and historical launch consent. Each staging attempt owns a distinct per-user object; cleanup must reconcile the mailbox claim before deleting after an ambiguous append and must derive the object path without depending on an access-controlled encryption-context lookup. The server association with an installation UUID is not hardware attestation; without App Attest or proof-of-possession, the upload token remains a bearer credential and must not be described as hardware-bound. Raw JPEGs must never enter Postgres, Temporal payloads, hosted mailbox payloads, logs, fixtures, or diagnostics. Cloudflare may hold them only as ingress-encrypted, per-user private R2 objects until post-checkpoint deletion or the lifecycle backstop makes them eligible for asynchronous deletion at 31 days, one day beyond mailbox recovery retention; that age is not a guaranteed physical-deletion deadline.
- The Photos-library permission remains the user opt-in boundary; a successful capture automatically ensures the private 9pm closeout without another consent flag. Enrollment and upload require an existing active private iMessage or Telegram thread or a verified email target; this is a deliverability precondition, not another automation opt-in. Web resolves the member-bound, access-checked direct route, reads the verified email only as a chat-route fallback, and carries the private target only in the encrypted mailbox envelope and member vault where ordinary automation delivery requires it. Before a direct email occurrence reaches the provider, the runner must use its existing signed, write-fenced Web-control boundary to replace the saved target with the bound member's current access-checked verified address; a missing or revoked address fails closed. The closeout may remove only a canonical meal whose external reference proves automatic meal capture, and only after the agent has inspected the photo and persisted any supported structure. The canonical mutation verifies current image and manifest receipts before replacing the JPEG with a non-image privacy tombstone.
- Prefer least-privilege defaults and explicit validation at system boundaries.
- Murph Safe and `/api/public/v1` are intentionally unauthenticated read-only
  surfaces over a narrow product projection. Search terms are private request
  inputs: accept them only in bounded POST JSON, never echo or log them, and
  keep them out of URLs, metadata, referrers, persistent browser storage, and
  analytics. Public responses may contain only normalized contract fields and
  provenance; raw labels, database errors, credentials, internal ids beyond
  the opaque product reference, and provider responses stay behind the server
  boundary. Product-test evidence must use the selected record's exact foreign
  key, never a canonical-key, name, brand, or fuzzy join. Preserve the code and
  SQL bounds documented in the Murph Safe product spec. Do not enable
  permissive CORS or credentialed browser requests. Production must set the
  explicit WAF build gate and exact rule ids in server-side deployment config;
  the verifier may inspect only the active project configuration and must not
  log its bearer or provider response body.
- The public reusable-referral landing is read-only. Its explicit dynamic
  `POST /r/<token>/claim` mutation must be covered by the production WAF's exact
  method plus path-prefix/path-suffix rule at 10 requests per minute per IP.
  The server then takes a non-blocking referral-claim advisory lock before its
  rolling per-referrer count and touches the shared member row only after that
  feature-local admission succeeds, so public claim pressure cannot queue
  billing, activation, settings, or account-deletion work.
- Hosted browser app sessions require `HOSTED_APP_SESSION_HMAC_KEY` as a dedicated web-only canonical 32-byte base64url key. The strict v2 cookie carries only its session id and random bearer; web must verify the existing row authenticator over domain/version, session id, bearer, member id, Privy identity, and expiry before trusting any row claim or reading member data. Resolution and revocation must use the authenticated id/tag pair, legacy unsigned cookies must fail closed, and the key must never be stored in Postgres, sent to Cloudflare or browsers, logged, or reused for contact privacy, mailbox fingerprints, provider credentials, or encryption. Before the strict-v2 production hard cut, the Vercel project must use Standard or All Deployment Protection so historical generated production URLs cannot expose a legacy app build; the authenticated project-setting verifier is a mandatory cutover gate.
- Privy completion with an ambient Murph app session is same-member reauthentication, not account switching. The fresh Privy user id and resolved member id must both match that app session before web issues a replacement session; a member who intends to switch accounts must end the current app session first.
- Every interactive authentication completion that may mutate Privy-derived identity, sender, routing, or messaging state must perform a bounded live-provider read for the exact principal, including new-member creation, changed-principal recovery, exact-principal consent retry, and lost-response retry. A changed principal may replace an existing member binding only when that live principal still owns a verified email resolving uniquely to the same member's durable verified-email authorization. The same live identity snapshot must supply every later identity, verified-email, sender-authority, routing, and messaging-state mutation in that completion; a bearer-token snapshot is candidate-lookup input, not replacement or downstream write authority. Every non-best-effort live binding, including secondary Telegram ownership, must be checked and written in the same transaction as the principal replacement so a split credential rolls the entire completion back. An exact already-bound principal remains the member candidate during an interactive retry; a different bearer or live phone cannot redirect or reject that retry. Interactive completion preserves a non-null stored phone whenever the live phone differs, and only the settings phone-link/transfer owner may replace it. Same-phone verification may refresh, and an absent phone may be filled only when the verified bearer and live projection agree and no other member owns that phone; optional enrichment never vetoes an exact-principal retry. Missing, stale, or mismatched provider state, phone-only changed-principal matches, credentials split across members on unbound or changed-principal attempts, and non-interactive callers such as App Review operations must continue to fail closed.
- Settings account linking must use Privy's link or update operation for the exact app-session Privy principal; login operations must not stand in for linking. Settings mounts one page-level Privy provider and opens the provider flow directly from the user action. Normal provider success syncs only the exact returned phone. Privy's `account_transfer_required` callback is a non-terminal handoff into its transfer UI, so a later provider-flow exit is only a wake-up: web management-reads the same Privy user and persists only a proven change from the phone observed immediately before the provider flow. An unchanged phone is a quiet cancellation, an absent intermediate replacement remains retryable, and an ambiguous Murph save retries the same expectation without reopening Privy. On remount, a phone present on the exact Privy principal but absent or different in the Murph projection is reconciled as that exact-phone expectation instead of reopening Privy. When Privy transfers a phone from another Privy principal, automatic reconciliation additionally requires a typed provider not-found for that exact source principal and two exact, transactionally locked proofs that the source Murph member is either the pristine `not_started` signup scaffold or the untouched automatic Pulse-trial scaffold. The allowlist includes only the known system-created billing, routing, workspace, mailbox, counter, crypto, consent, unused web-invite, and same-Privy web-session shapes; any member activity, product state, device state, connected-app or clinical state, credits, referrals, shares, feedback, phone-bound invitation/outreach, or ambiguous state fails closed to support. Murph first commits a source suspension fence, then the existing account-deletion owner performs provider and billing cleanup. Its final transaction management-reads the target Privy principal immediately beforehand, takes the phone lock before sorted source/target member locks, revalidates the exact disposable scaffold, persists the cleanup receipt, deletes that fully proven scaffold, and attaches the phone plus channel projection to the target atomically. General or active member data is never auto-deleted because any such state fails the disposable-source gate.
- Rebuildable inbox-derived artifacts can still contain sensitive health data and must be treated as high-sensitivity runtime material. Never persist provider secrets alongside those artifacts.
- Hosted clinical-record retrieval is a web-owned credential and provider-egress boundary. Web alone stores encrypted FHIR access/refresh tokens, resolves the provider base URL, follows same-base pagination, and returns one size-bounded sanitized JSON page through signed, active-write-fenced runtime callbacks. The system mailbox and Temporal signal contain only `{runId, generation}`; runtime descriptors contain only opaque ids and hashes. Never put tokens, raw patient ids, raw FHIR base/page URLs, authorization headers, raw page bodies, or clinical values in Postgres, Temporal state, assistant session state, model prompts, diagnostics, or logs. `@murphai/vault-usecases/clinical-records` may atomically stage only the already-bounded sanitized pages in private `.runtime/operations/clinical-records/**` state so the encrypted hosted workspace can resume after foreground preemption; that non-canonical checkpoint is portable, schema- and run-bound, and removed on terminal completion or rejection. Full semantic validation still precedes final raw-page/manifest persistence. Web current-run authority is rechecked immediately before the raw batch and again before canonical mutation. The initial backend lane allows one retrieval generation per unique member/provider connection so immutable raw evidence cannot grow through repeated retrieval jobs; retry, reconnect, or refresh must remain closed until a bounded retention lifecycle preserves every canonical raw reference. A terminal `authorization-required` response is web-owned: web clears unusable credentials and marks the connection `needs_reauth`, while runtime must not overwrite that terminal outcome.
- Clinical query-scope and slice ids are bounded adapter-owned acquisition
  identifiers. They may be stored in the run plan, runtime descriptor,
  operational page claim, checkpoint, and raw manifest, but must never contain
  provider URLs, patient ids, clinical values, or credentials and must never
  enter the canonical FHIR external reference. Query-aware cursor encryption
  and request fingerprints bind both ids, the resource type, and the frozen
  query fingerprint; a cursor or claim from another scope or slice fails before
  provider egress.
- `vault-cli route estimate` is an env-gated external egress surface backed by `MAPBOX_ACCESS_TOKEN`. Keep the token in env only, treat any Mapbox geocoding or Search Box lookup as temporary/non-persistent, do not persist route inputs or outputs in Murph state, and only return route geometry when the caller explicitly asks for it. Hosted execution may expose that same CLI path only when the Worker secret is intentionally configured for Cloudflare's runner egress intercept; the raw token must not be copied into the hosted runtime env.
- `vault-cli research scout` is an env-gated external egress surface backed by `EXA_API_KEY`. Conversation-facing single-scout input requires `mode: "focused"`; managed broad discovery uses `research scout-batch`. Every provider-bound profile value in either lane must belong to the finite, field-specific, server-owned public concept set. Focused mode synthesizes a fixed provider question from those values and never accepts arbitrary question prose or categories. A question that cannot be represented by the set must make no Exa call. Batch lanes retain the legacy tag-only query, prompt, and provider route. The tool must not persist Exa output or profile payloads; assistant flows may append only curated, deduplicated, non-diagnostic research-scout summaries through the normal knowledge surface.
- Hosted Clinical Records keeps Epic SMART client configuration, OAuth state,
  PKCE verifiers, patient ids, access tokens, and refresh tokens in `apps/web`.
  Patient/token/verifier/cursor ciphertext uses purpose-specific hosted crypto
  lanes and exact member/connection/version AAD; raw secrets must never enter
  prompts, Temporal, assistant state, workspace snapshots, logs, callback
  redirects, or client-safe connection projections. Runtime requests require a
  callback signature bound to the member plus Cloudflare's active attempt,
  lease-generation, and workspace-version fence.
- Hosted domain-root key rotation must be reader-first. Keep the required
  single-key authority and Cloudflare automation variables as the active
  generation while optional keyrings add only `verify_only`, `decrypt_only`,
  or `disabled` compatibility entries. Authority private signing material must
  remain non-exportable in GCP KMS; an exportable Cloudflare private JWK may
  exist only in approved secret stores and secret provider inputs. The sole
  plaintext-file exception is the ignored
  `apps/cloudflare/.deploy/worker-secrets.json` payload rendered for Wrangler:
  its parent must be mode `0700`, the file mode `0600`, and the file may be
  consumed only through Wrangler's `--secrets-file`. Protected production
  deploys run on an ephemeral worker whose disposal owns cleanup; any direct or
  local deploy must remove that exact generated file after success or failure.
  The file is never a source of truth. Private JWK values must never enter CLI
  argument values, logs, tracked or review artifacts, or any other plaintext
  file. Web build and Worker deploy preflight must share one runtime-state
  acceptance contract for optional standby rings. Before provider mutation,
  complete-preload validation must require all three authority/public/private
  payloads, reject required-active-ID collisions, require the intended
  `verify_only` / `disabled` / `decrypt_only` statuses under explicit proposed
  IDs, reject duplicate normalized IDs, and match the Cloudflare public/private
  P-256 coordinates by key id. Web public entries and public JWKs must use
  closed raw schemas so sibling private material or another ignored field cannot
  enter Vercel. All three ring strings must reject duplicate JSON object members
  before the first ordinary parse, so discarded earlier members cannot remain
  in provider-bound text. Before provider mutation, the complete-only command
  must import the exact proposed authority PEM as a P-256 ECDSA verification
  key and prove the exact Cloudflare public/private JWKs by wrapping and
  unwrapping an ephemeral challenge;
  errors may name fields but must never reproduce values. Proposed IDs are
  non-secret one-shot operator validation metadata, not provider runtime
  configuration. Record the current
  ready Web deployment, deploy Web first, and prove the unchanged active Web
  crypto context before changing the Worker; a build success is not runtime
  proof. A standby preload must not mutate envelope key references. Activation,
  re-signing, rewrapping, and retirement require an explicit production
  mutation owner, a reader-complete compatibility window that retains the
  current Cloudflare private key, and aggregate proof of zero old active or
  `decrypt_only` references before old
  material is disabled or removed.
- Clinical provider egress is allowlist-derived, never caller-URL-derived. The
  committed directory and SMART discovery pin HTTPS origins; FHIR continuation
  URLs must retain the exact origin and resource-family path, redirects are
  disabled, and private/loopback/link-local/mapped-private literals are rejected.
  Each server-derived page fingerprint has one active claim, and every actual
  FHIR fetch atomically consumes the provider-request budget plus a full-page
  egress reservation before network I/O. Completed recovery replays are
  explicitly charged and bounded; caller request ids cannot create same-page
  fanout.
  SMART/FHIR response streams must cancel once their byte bound is crossed even
  when `Content-Length` is absent or underreported. Logs may include only a
  normalized error code/type and booleans/counts, never callback state/code,
  tokens, patient ids, URLs, or provider response bodies.
- AgentMail-backed email polling and delivery must keep API keys in environment variables only, must not write raw Authorization headers to vault/runtime artifacts, and must limit assistant auto-reply to positively classified direct threads or signed hosted group routes that resolve to a current grantor; indeterminate or malformed hosted routes must fail closed. A signed group route is routing authority, not SMTP sender authentication, and must never authorize any assistant-style mutation, whether personal or room-owned.
- The companion legal-consent route is shared by the iOS and Android apps. It
  records the generic server-owned `native-companion` audit source because
  member authentication does not attest the client platform; a request's
  client-supplied source label must never become audit authority.
- Cloudflare-hosted reply aliases are private signed routing capabilities, not SMTP sender-identity proof. Hosted email ingress may accept the current per-user signed reply alias after the web-owned callback resolves its alias key to an active member, and it must do that before persisting the raw `.eml` or dispatching hosted execution; leaked aliases must not route to another member or be described as verified email ownership. Web is allowed to derive and display the same deterministic per-member alias as Cloudflare because web owns member routing state; verified-email sync should persist the alias lookup key before settings presents the alias as reachable. Treat hosted email signing-secret rotation as a compatibility event because deterministic displayed aliases and stored lookup keys are derived from that secret. Direct mail to the fixed public sender address must remain fail-closed unless a trusted runtime seam supplies a provider-authenticated sender verdict with aligned SPF, DKIM, or DMARC proof, then resolves only through a synced verified-owner index that stores secret-derived sender hashes instead of raw verified emails. The direct-public path must require matching envelope and `From` sender values plus authenticated sender proof before lookup, public-sender misses or failed owner authorization should be accepted-and-dropped instead of bounced so the mailbox leaks less account state, new outbound mail should reuse one stable per-user reply alias instead of minting fresh per-thread route state, and any accepted reply-alias message must remain scoped to the alias owner. Every direct hosted email egress, including a serialized thread reply, must resolve that owner's current verified email immediately before provider entry and replace the target's entire `To`/`Cc` audience with only that address; group targets continue through group authority and fanout unchanged. The hosted worker must never treat envelope/header `From` fields or raw `Authentication-Results` / `ARC-*` headers as authentication proof.
- `POST /api/device-sync/companion/admission` is the admission-only native
  account boundary. Its Privy bearer may create or recover the canonical hosted
  member through the existing consent, untouched-member trial, and access
  owner, but the closed request accepts only an optional validated IANA time
  zone and the response is always the non-identifying `{ "ok": true }`. The
  route requests the existing signup-welcome suppression policy so account
  admission cannot reserve a Linq home line, queue a signup welcome, or send a
  welcome email; canonical trial activation and its internal
  `member.activated` fact remain unchanged. The route must not import or invoke
  device-sync public ingress, mint Junction authority, or create, resume,
  reactivate, or otherwise mutate a device connection. Validate the complete
  bounded body before acquiring Prisma or running member admission. Its
  route-owned error boundary preserves only the
  stable native login, consent, access, suspension, and alternate-sign-in
  identity-conflict outcomes, normalizes every other retryable owner failure
  to `COMPANION_ADMISSION_RETRYABLE`, and normalizes every remaining terminal
  setup failure to `COMPANION_ADMISSION_SUPPORT_REQUIRED`. Do not expose
  internal hosted lifecycle codes through this route or let a client retry the
  terminal support outcome in a loop.
- Native iOS and Android device-sync routes under `/api/device-sync/companion/**` normally authenticate with a Privy identity token in `Authorization: Bearer` (no cookie fallback, so no browser ambient authority or CSRF surface). The sign-in contract accepts only `platform: "ios" | "android"` when supplied. The Messages enrollment route follows the bearer rule, then mints a 24-hour Messages-only bearer; the revoke and proof-action routes are the only companion exceptions that accept that derived scope. The one pre-login exception, `POST /api/device-sync/companion/auth-diagnostics`, accepts only an allowlisted, size-bounded failure envelope containing app-owned categories, an optional closed platform value that defaults to iOS for legacy clients, and an optional Murph-recognized Privy auth machine code; unsupported provider codes become `null`. It writes one structured hosted warning, has no database or object-storage sink, and must never retain or log raw provider prose, email, phone, OTP, tokens, authorization headers, member/user ids, or health data. Treat its telemetry as spoofable rather than audit evidence; a bundled mobile secret is not an attestation boundary because it can be extracted and replayed. Production keeps this route hidden unless `MURPH_COMPANION_AUTH_DIAGNOSTICS_ENABLED=1`, and the production build must use explicit Vercel API credentials to prove the enabled WAF rule is the first active custom rule, matches only this exact path, and caps requests at 30 per minute per IP with a fixed window. The Junction SDK sign-in token authenticated routes mint is short-lived, returned exactly once, and must never be logged or persisted. Only a visible Android Connect Health Connect action or explicit hosted reconnect may send `connect` and run the account-ensure step, which must reuse the shared device-sync `upsertConnection` external-account identity discipline so SDK and Junction Link flows always share one `device_connection`; passive `resume`, omitted-intent reconciliation, foreground return, and data ingress may not ensure or reactivate a row. Source-scoped status accepts only a normalized Junction provider slug and filters both connected-source availability and durable webhook receipts. A receipt may store `sourceProviderSlug` only when the provider-owned webhook parser identifies an actual data-bearing source; data-less historical completions, lifecycle events, and legacy rows keep it null and cannot satisfy a source-scoped read. The junction client's API-key-prefix/environment validation is the sandbox/production separation authority, and the response surfaces the active environment.
- Initial onboarding follows the same bearer-only native boundary and accepts no
  member id from the client. The browser completion route instead requires the
  normal hosted app session plus same-origin/CSRF enforcement. Both routes
  parse the same closed save-or-skip shape and enter one member-row-locked
  transaction, so a stale surface cannot replace the first surface's assistant
  preferences. The native catalog exposes only public presentation metadata;
  contact-card download uses a five-minute signed handoff whose member and
  avatar are server-derived. Never log identity tokens, signed handoffs, or the
  resulting contact-card URL.
- The companion address-book route accepts only a 192 KiB closed projection of 1-1,000 canonical international phones with either one safe first-name token plus an optional last initial or two to four distinct safe labels joined by the explicit ` / ` alternative separator; sentence-shaped labels, more than four alternatives, and empty enabled projections fail closed. The iOS producer case-folds and sorts eligible labels, then keeps the first four and omits later labels from the advisory prefix. The alternative form preserves disagreement without inventing one full name or choosing a winner; its bounded prefix may be non-exhaustive. An empty contact list is valid only as an exact replay probe for an already-committed replacement and can never create or replace a projection. Replacement requires active access and current launch consent; authenticated status and self-deletion remain available without active billing so cleanup is not trapped. Web must immediately replace each phone with a member-scoped HMAC token derived through the dedicated non-exportable KMS MAC keyring, and Postgres must store only token/version plus a member-bound encrypted label. Do not reuse the web wrap key, app-session HMAC, existing global contact blind index, or any content-encryption key for these tokens. A database or ordinary-content-key compromise must not be enough to test phone candidates. This is not zero knowledge: live Web MAC authority and live group processing remain sensitive boundaries. Only an authorized live group route may consult the human group owner's enabled projection, through either `read_chat_participants` for a canonical current phone participant or an exact provider-authenticated Linq participant add/remove event for that routed group. The event consumer must first prove that the matching hosted identity lacks active Murph activation evidence, may retain the label only in the existing bounded encrypted one-shot route context, and must present it as weak context rather than participant-authored text. Participant label staging and projection replacement/deletion must share the owner-member lock; every non-replay replacement or deletion clears pending encrypted group-event buffers for that owner's routes before commit, so an unconsumed revoked label cannot reach the model without adding an ordinary-message lookup. The participant event transaction must also reject any changed-handle lookup key that belongs to the routed Linq account, even when the provider omits `is_me`. Before KMS or token lookup, each advisory read must confirm that the owner still exists, is unsuspended, and holds current launch consent. The read must not reapply personal or sponsored billing access to an already-enabled projection; the authorized live group route is its access boundary. The participant's durable activation result remains independent; a label for a registered participant must never replace or modify their Murph identity. Labels must never grant identity, membership, consent, route, delivery, invite, signup, or profile authority, and optional lookup failure must leave the truthful roster and ordinary message path unchanged. Provider-event ledger rows must retain no participant handle or label. Replacement/deletion must remain CAS/replay safe; the projection remains active until explicit stop, account deletion, or the companion's next foreground reconciliation after Contacts permission loss removes it, and account deletion must remove both owner tables. No-expiry projections may pin the prior readable MAC version indefinitely; routine retirement must wait for the indexed row count to reach zero. Emergency retirement must deploy both gates Off, retire and drain every old Web writer for at least the route's explicit maximum duration, disable the affected key, reset each complete affected projection through the locked delete-shaped lifecycle so status is truthfully Off and revision/CAS history remains, prove zero affected rows, deploy the new keyring before reopening replacement, require explicit re-sharing, and reopen advisory reads last.
- The automatic authenticated Linq speaker-label read is a third presentation-only consumer of that same route-authorized address-book projection. Web must first resolve exact current room membership: one unsuspended member's authorized `profile-name.v0` snapshot wins; ambiguous or suspended matches stay unnamed; and only a canonical phone with zero matches or one unsuspended match without a profile name may reach the existing set-based owner-contact reader. The response may contain only the sender handle, bounded display name, explicit profile or unverified-contact provenance, and exact handles proven to have no name after every applicable authorized source was checked—never a member id or participant id. The runner keeps only an operation memo plus the bounded private 14-day-positive/six-hour-proven-negative file cache under `.runtime/cache/**`; cache keys are opaque and route-scoped, the cache is excluded from snapshots, and corrupt, stale, unauthorized, or unreadable state is a miss. Neither the response nor either cache supplies identity, membership, consent, routing, matching, persistence, delivery, or effect authority. Only an exact accepted message reference plus trusted server derivation may authorize a participant-scoped effect.
- A speaker-label result is cacheable only after its source is complete at the existing authority boundary. An active `profile-name.v0` grant with a null pending snapshot is unavailable, never evidence of profile absence or permission to fall through to an owner contact. The address-book reader checks at most 16 exact phones; only those submitted handles may receive contact labels or negative evidence, and batch overflow remains operation-local. This uses the existing next-operation recovery path and adds no invalidation or readiness state.
- Messages mini-app credentials are random, member-scoped, and persisted only as Messages-domain-separated lookup hashes in one deterministic Messages-owned row per member in the existing short-lived session table; never persist the raw-token hash that the historical unscoped device-agent reader used. Before enrollment reads identity or authority, it must finish validating the bounded request body. Credential issuance must then lock the hosted member and active sponsorship rows, re-check active access and current launch consent, and atomically rotate that one feature-owned row in the same transaction so repeated enrollment stays bounded and account deletion serializes without post-deletion recreation. Every rotation mints a fresh bearer, replaces the lookup hash and expiry, clears revocation/replacement state, and leaves ordinary device-agent rows untouched. Explicit revocation and expired-session cleanup must compare-and-set on the exact authenticated lookup hash as well as the stable row id, so a stale credential generation cannot revoke its replacement. Device-agent routes must also require their distinct `hbds_agent_` prefix before hashing so an `hbds_imessage_` credential can never export wearable credentials across current operation or reader rollback. Re-check active hosted access and historical launch consent on every proof action (proof taps happen inside the extension with no consent UI, so stale document versions must not break them while members with no launch grant stay fail-closed), while keeping authenticated self-revocation available after access or consent is lost so cleanup cannot be blocked. Keep the message URL capability-less: the only private-state exception is a bounded V3 compact-table fragment containing immutable values already visible in that private-direct message. The fragment may contain health-related presentation values, but never a member identity, canonical record reference, credential, token, or other authority; it is decoded locally and never requested from the Web origin. Never log the full compact-table URL. Never link Privy into the extension, and never copy, persist, log, or share a raw Privy access, refresh, or identity token. The containing app must explicitly address the shared Keychain group for the derived credential while keeping each target's private group first so Privy's default Keychain storage remains private.
- The same narrow capability-less presentation exception includes V4 workout
  envelopes: neither V3 nor V4 carries tracking,
  identity, canonical references, credentials, tokens, or write authority.
  V1-V4 presentation envelopes may also reach the bounded queryless
  `/imessage/card/v1/:payload.png` route for Linq's static fallback. That path is
  immutable message content, not an authenticated card API: strict parsing runs
  before bundled asset reads, the renderer performs no database or remote read,
  writes no application log or analytics event, and returns private
  no-store/no-index headers. Never log either complete URL or encoded payload.
- The authenticated companion WHOOP overnight-PRV route accepts only the strict,
  size-bounded six-field `murph.companion.overnight-prv-rmssd.v1` envelope:
  `schema`, `methodVersion`, `nightDate`, `rmssdMs`, `completedWindowCount`,
  and `acceptedWindowCount`. Unknown fields fail, and the only method is
  `prv-rmssd-5m-mean-scheduled-0000-0800-local-v1`.
  The route must never accept, log, persist, or echo exact capture timestamps,
  duration, timezone offset, coverage milliseconds, R-R intervals, raw BLE
  bytes, packet timestamps, heart-rate samples, per-window values, device
  identity, Apple Health values, or WHOOP account data. The phone alone enforces
  its per-window interval coverage policy; the server validates only the
  compact nightly contract, including 84...108 completed windows, at least 48
  accepted windows, and at least 50% acceptance among completed windows.

  After explicit enrollment, iOS continuously subscribes to the band and owns
  the fixed `00:00–08:00` local schedule. It freezes the schedule's timezone
  rules for each night. A fully traversed occurrence is bounded to 84...108
  completed five-minute windows: typically 84, 96, or 108, with intermediate
  counts such as 90 or 102 when the zone shifts by half an hour. The backend
  owns no capture scheduler. The only health-derived local persistence allowed is one
  schema-versioned, OS-protected scalar checkpoint for the current scheduled
  night plus at most three already-derived strict-envelope outbox entries. The
  checkpoint is limited to frozen schedule/night identity, window position,
  completed/accepted counts, and accepted-RMSSD sum. The exact app-scoped
  CoreBluetooth peripheral UUID may persist in the same protected local state
  solely to restore the enrolled band, but it never uploads or enters logs. Raw
  intervals, packets, heart-rate samples, partial-window state, per-window
  values, WHOOP account identity, and every other band identifier remain
  memory-only; the current partial window is discarded across a process gap.
  Exact capture times, duration, timezone details, and coverage are neither
  uploaded nor logged.

  The local Connect WHOOP control enrolls only the CoreBluetooth band and must
  not send hosted `connectionIntent: "connect"`. Known same-member passive SDK
  repair sends `resume`. A fresh or unproven install omits intent so durable
  server state decides: exactly one established row resumes, zero provider rows
  may establish the first lane, and terminal or ambiguous state rejects without
  mutation. Only a future visible hosted-health/Junction Reconnect action may
  send `connect` and create or reactivate the hosted lane. Data ingress and
  outbox retry may not. Local band disconnect or sign-out disables BLE resume
  and clears the local enrollment, checkpoint, peripheral UUID, and unsent
  outbox after cleanup without silently changing hosted connection state.
  Force-quit prevents iOS from relaunching the app for BLE until the member
  opens Murph again; a single local watchdog notification may be continually
  postponed while callbacks are healthy and fire only when reopening is needed.
  That notification must contain no health value, band identifier, or account
  identifier.

  The route reuses one authenticated, consent-gated, active member-owned
  Junction connection and never establishes, recreates, or reactivates one from
  data ingress. The first accepted strict envelope owns `(connection,
  nightDate)` for 30 days. Inspect that replay identity before first-admission
  freshness and connection gates: exact retries are no-ops, changed content
  conflicts, and expired or unseen work must pass current admission. The
  web-owned receipt stores only member/connection binding, a hashed receipt id,
  strict-envelope hash, and creation time, never the observation or a capture
  identifier. It is excluded from hosted workspace snapshots, lazily expires
  through its indexed owner/connection/time path, and is capped at 64 rows per
  connection.

  Accepted envelopes enter the existing encrypted device-sync dirty-payload
  handoff and canonical importer path. Web, runtime, and importer boundaries
  recompute the SHA-256 admission identity; the same local job row survives
  yield, lease expiry, retryable failure, hosted refetch, cold restore, and
  disconnect. Acknowledge the hosted payload only after canonical success or
  the exact structurally invalid terminal result. Runtime hydration keeps its
  existing hosted-connection-first identity binding and fail-closed legacy
  consolidation rules.

  Receipt cardinality is connection plus `nightDate`; canonical cardinality is
  vault plus source (`whoop`) plus `nightDate`. Import stores one immutable
  summary-grain `whoop-ble-overnight-prv-rmssd` observation with a synthetic
  12:00Z `occurredAt` and no event `timeZone`. The metric has no generic `hrv`
  or biomarker alias. This is a beta wellness pulse-rate-variability
  estimate, not clinical ECG HRV, WHOOP's proprietary overnight HRV, or WHOOP
  Recovery. Apple HealthKit SDNN remains
  `hrv-sdnn`, and the existing provider resolver keeps WHOOP Recovery/Oura HRV
  under its single selected daily `hrv-rmssd` owner. Deploy the
  runtime consumer first with immediate container rollout, runner-bundle
  fingerprint proof, and a compact import smoke; deploy web second and release
  iOS last. Web must understand `resume`, omitted-intent server inference, and
  the future explicit `connect` authority before the automatic client ships.
  Direct-BLE enrollment sends no hosted lifecycle intent. Separately, known
  same-member passive SDK repair uses `resume`, while a fresh/unproven install
  omits intent and may establish only when zero provider rows exist. Terminal
  or ambiguous state rejects, and omission must never reverse a durable
  disconnect. Before iOS distribution,
  require a signed physical-iPhone
  continuous-stream and overnight WHOOP 5/MG capture-to-query test, including
  background, reconnect, force-quit-watchdog, DST, and timezone-change cases;
  network/log proof that forbidden raw data is absent; and paired-ECG
  validation. Once scheduled-method clients ship, keep web and runtime support
  until those clients and all staged envelopes have drained. Roll back in
  reverse order, draining staged work before runtime support is removed.
- Direct Strava webhook POST delivery must fail closed unless the provider-owned signing secret verifies the `X-Strava-Signature` timestamp and HMAC over the raw body. The Strava GET verify token is only a subscription-challenge/admin secret, not POST delivery authentication. Junction-backed device sync uses Junction's own webhook signature boundary and must not depend on direct Strava webhook trust.
- Hosted Linq first-contact admission is a web-owned OpenAI egress path for unknown first-contact candidates. Keep `HOSTED_ONBOARDING_LINQ_FIRST_CONTACT_ADMISSION_OPENAI_API_KEY` or the fallback `OPENAI_API_KEY` in web environment configuration only. The approved classifier input is bounded first-contact text plus sparse contact-kind/part-type metadata and a fixed `imessage`/`sms`/`rcs`/`unknown` service enum; do not add member ids, raw provider payloads, routing secrets, invite codes, mailbox bodies, transcripts, contact lookup keys, attachments, or prior conversation context. Do not persist classifier prompts, raw responses, model rationales, provider response bodies, or raw first-contact message text. The legacy nullable rejected-message-text column is retained only as an ignored deploy-skew compatibility column during the expand/contract rollout, and the migration scrubs existing values rather than dropping the column under old app code. Persist only the event-id keyed terminal allow/block decision with confidence/source so replay and concurrency observe the same admission result, and keep that decision write duplicate-safe by event id without relying on caught unique-constraint errors inside open transactions. An instant-start invite may retain that event id as single-owner provenance for the exact original inbound. Only the transaction whose unique phone-identity insert creates a genuinely new member may mint that authority; a loser retries before invite or accounting work, and an existing member without the exact token remains on the signup path. Activation requires the referenced decision to remain a model-source allow and revalidates the exact invite and event under the member lock before any Stripe mutation. A different inbound cannot reuse that authority. Logs may include only sanitized confidence/source/failure metadata, safe bounded provider error code/type/message/request-id-presence, and event id suffixes. When admission enforcement is enabled, textless deterministic blocks, explicit classifier blocks, OpenAI refusal, content-filter outcomes, and first-contact budget exhaustion must be acknowledged as blocked without member creation, invite creation, reply send, read receipt, wake, or mailbox side effects. When enforcement is off, a genuinely unknown member on a provider-authenticated direct iMessage from a configured E.164 phone prefix may use the classifier solely to qualify for instant start: only a persisted `allow` with `source=model`, exact same-line routing, and an unbound Stripe customer may enter the existing full Pulse-trial path. The unbound-customer check prevents an old saved payment method from silently auto-converting a trial started only by texting Murph. Model blocks, deterministic fail-open decisions, classifier unavailability, budget exhaustion, SMS/RCS, groups, email handles, unsupported prefixes, unrelated existing members or billing customers, and cross-line routing must retain the existing signup-link or ignored behavior and must never mint instant-start entitlement. Calling-code or phone-prefix filtering is abuse friction, not nationality, residence, carrier, or fraud attestation. The default is an explicitly reviewed launch-market list, and operators may replace it through `HOSTED_ONBOARDING_LINQ_INSTANT_START_PHONE_PREFIXES`; `+1` still includes the full NANP.
- Inbound message content written by the retention-capable owners has one receipt-anchored 14-day maximum across hosted mailbox ciphertext, vault capture text/raw fields, out-of-line text, parser bundles, SQLite/FTS projections, assistant input events, and user transcript entries. The deadline is inclusive and active or retryable work cannot extend it. Every new user transcript entry carries `contentReceivedAt`; retention must never infer a missing legacy receipt from transcript `createdAt`, an accepted-turn journal, or an input event because normal settled-snapshot cleanup may already have discarded that join. The phase-one rollout therefore preserves unstamped legacy transcript entries while re-arming existing snapshots once to queue cleanup of every carrier with trustworthy receipt evidence; the rollout remains incomplete until that queue drains. Only after both 14 complete days from verified stamping-capable runner convergence and phase-one drain completion may a separate phase-two migration re-arm those snapshots again and retire every remaining unstamped user entry. Postgres cleanup deletes sidecar payload ciphertext, clears inline payload fields, and retains only structural mailbox metadata. If a conversation message reaches the deadline without terminal handling, the existing mailbox row becomes a durable `policy_non_reply.content_expired` tombstone and the runtime records its existing suppression evidence before local content retirement; neither owner may silently delete accepted work or later resurrect it as replyable. Promoted canonical health facts, explicit user saves/pins, Murph replies, delivery evidence, and content-free structural/audit metadata are outside this inbound-message-content policy and retain their owning lifecycle.
- The Cloudflare `runtime/ensure-processing` route accepts exactly two credentials: the Temporal orchestrator's web-callback signature and web's Vercel OIDC identity (the same identity already used by the browser-vault/status/deletion control routes). Authorization dispatches on the credential the caller presented and never falls through a failed signature to OIDC or vice versa. The web direct wake is a post-Temporal latency hint for eligible Linq and Assistant Ask request/completion mailbox appends, carries no message payload, mints diagnostics-only `web-ingress-` attempt ids, and grants web no authority it did not already exercise through the accepted Temporal signal; the `triggeredByWebDirect` diagnostic is derived from the authorizing credential, never from caller-supplied fields. Hosted R2 reads, writes, restores, presigns, and account deletion use one environment-selected ENAM bucket; authenticated callers cannot select a bucket, region, or presign target. The Assistant Ask child receives only the server-bound requester membership `participantId` as immutable identity context: first-person references require an exact `read_shared` participant match, while display names, handles, member order, and the opaque id itself are forbidden output authority.
- One-time group-sender disclosure accepts only an opaque accepted-input id from
  the current authenticated group turn. Web must reopen that exact encrypted
  conversation wake under the synthetic group runtime, require a non-direct
  Linq or Telegram message with current route authority, resolve the author
  through the channel's canonical identity index, and derive the exact
  untruncated authored text plus the fixed self-only permission. The wake's
  optional `senderMemberId`, visible sender labels, handles supplied by the
  model, and roster position are never target authority. The resolved author
  must own an active personal runtime and must not be another thread container.
  Admission, personal-read preparation, completion, and final delivery must
  revalidate the same group runtime, accepted input, route, author, question,
  permission digest, target, expiry, and deterministic request identity.
  Linq and Telegram must carry the exact completion proof into their existing
  Web-owned provider-entry authority transaction; route authority alone is
  insufficient. Stale disclosure authority must replace the reviewed answer
  with the fixed text-only fallback before provider dispatch.
  Textless, oversized, direct, email, stale-route, cross-runtime, scheduled, or
  unresolved requests disclose nothing and create no reusable grant.
- The hosted assistant-configuration tool may reach only the bounded signed `POST /api/internal/hosted-execution/assistant-configuration/tool` web callback through `web-control.worker` under the exact active runtime write fence. The callback binds the operation to the runtime-authenticated member, accepts only the closed Luna/Terra/Sol model set and common `low`/`medium`/`high`/`xhigh` reasoning set, and re-derives active personal access plus Sol's paid-Edge entitlement from web-owned Postgres state. Reads need no member decision. Assistant-driven updates require an explicit request in eligible accepted user input for that turn. The runtime forwards only the terminal input id from a locally revalidated, bounded exact-successor provider batch; inside the mutation transaction, web binds it to the callback member and exactly one live conversation-lane mailbox row before the matching field-level preference write. Missing, legacy, mismatched, or ambiguous input authority fails closed. Never trust a model-provided member id, plan, availability list, current preference, causal sequence, or configuration claim as authority. A successful mutation changes only nullable web-owned next-turn preference fields; it must not mutate the running turn, mint a wake, or return billing records, credentials, or other member data to the runtime. The control request accepts only the input-bound update shape and rejects approval or resolved-target fields before the handler runs. The authenticated Settings form remains a separate direct member-action boundary protected by the normal app session and CSRF controls.
- Only an authoritative assistant-configuration web response with `updated` or `unchanged` status may refresh the ephemeral target for later provider turns in that invocation. Failure statuses leave it unchanged, the current turn remains immutable, and web remains the sole durable preference owner. A model or reasoning change must preserve the provider-native Codex thread and apply both settings on the next separately accepted `turn/start`; it must not bootstrap a replacement thread merely because those preferences changed. Idle compaction must attribute usage from the model actually bound to the warm thread rather than the future preference and skip provider work when that bound model cannot be priced.
- The hosted plan-usage tool may reach only the bounded signed `POST /api/internal/hosted-execution/plan-usage/tool` web callback through `web-control.worker` under the exact active runtime write fence. It accepts no model-provided member id or arguments: web binds the read to the runtime-authenticated member and returns the same bounded usage projection used by Settings. Web alone derives access, plan labels, percentages, forecast, and any recommended billing action from current Postgres state. The tool has no Stripe read or mutation authority, cannot create or lock an allowance period, and must return `group_not_supported` for synthetic thread containers rather than exposing personal billing facts in a group runtime.
- The Cloudflare Telegram usage-limit notice route accepts only web's exact project- and environment-pinned Vercel OIDC identity and requires the bound-user header to match the route user. Web owns the durable delivery claim plus recipient and message selection; the Worker accepts only the narrow send tuple and owns Telegram credential injection. Vercel OIDC is the sole intended web-to-Worker credential for this route; do not add a co-located shared signing secret that cannot prove the database claim or prevent replay. The runner cannot call this route. After OIDC and request validation, web atomically starts the exact period-scoped delivery immediately before the request, retries only failures proven pre-provider or explicit Telegram rate limits, and treats other post-dispatch uncertainty as terminal because Telegram has no idempotent-send primitive. The delivery row is the sole durable dispatch owner; do not add a parallel allowance-period marker.
- The Cloudflare-to-web hosted runtime owner-release callback is a separate narrow signed control-plane acknowledgement, not a work payload or scheduler. Cloudflare may call it once only after an exact successful completion clears the matching write fence, with no request body and a timeout capped at two seconds; a just-finished future mailbox retry continuation skips the callback. Web accepts only the empty query or the exact signature-bound positive `immediateRecheckRequested=1` query, derives the user only from the signed user header, and applies the normal nonce/replay checks. Without the positive edge, Web emits the existing payload-free `runtime_recheck_requested` Temporal signal only for current runnable mailbox lag and never infers work from a persisted due wake alone. The positive edge is normally transient invocation output for a newly committed default or retention schedule that this invocation produced but did not service; inherited or already-attempted wakes do not emit it on the ordinary result path. The narrow exception is transport-loss recovery after explicit inactive-container proof and durable workspace-version advance: because attempt-local provenance is unavailable, Cloudflare may conservatively emit the edge for a recovered due default wake, causing one facts re-read. Known future mailbox retry continuations never emit it. Empty facts and suppressed retry continuations leave the existing owner horizon intact. Do not persist the edge or add mailbox content, checkpoint refs, wake metadata, secrets, or provider data to this callback. Failure is non-fatal and Cloudflare must not retry it or reinterpret the completed runtime result.
- The internal RunnerContainer-to-UserRunner completion receipt is not a second completion authority. RunnerContainer may send it only after a parsed successful result settles and the matching in-memory operation is absent. UserRunner must re-read and compare the runtime-kind user, attempt, and generation before using the existing full-token completion compare-and-swap; stale, duplicate, or mismatched receipts are no-ops. The receipt stays on the existing Durable Object binding, is never exposed as an HTTP route or written to logs, and failure must preserve the completed result and the outer UserRunner completion fallback. Checkpoint success, container stop, idle expiry, and elapsed time remain insufficient authority.
- The completion receipt wait is capped at one second. Timeout returns the already completed runner result to the outer fallback, and any late receipt rejection is observed without changing fence authority or retrying the invocation.
- Cloudflare Durable Object storage that holds hosted gateway projections, gateway event logs, or similar hot derived user data must stay encrypted at rest with the worker's hosted storage crypto rather than being persisted as plaintext coordination state.
- Hosted R2 storage namespace ids are metadata-opacity helpers, not auth boundaries. The deterministic `hsn_${hash(userId)}` namespace is acceptable only while hosted user ids remain high-entropy random ids, R2 buckets stay private, and stored payloads stay encrypted. Do not log, export, or expose hosted R2 object keys or namespace ids to users or third parties; enforce access through signed control-plane requests, Durable Object user binding, crypto context authority, and explicit ownership checks. If user ids become guessable or any R2 object key/listing can leak outside trusted runtime operators, switch the namespace to a stored random per-user `storageNamespaceId` or a versioned secret-HMAC-derived value before exposing that surface.
- Hosted per-user env overrides are for per-user credentials and verified-identity metadata only. They must never be allowed to set executable selectors or process-control variables such as `FFMPEG_COMMAND`, `WHISPER_COMMAND`, `WHISPER_MODEL_PATH`, `NODE_OPTIONS`, `LD_PRELOAD`, or `DYLD_INSERT_LIBRARIES`, because those values can steer subprocess execution inside the hosted runner.
- Every member-scoped hosted runner operation that can decrypt private content, access hosted artifacts, call the signed web control plane, or mutate durable state must validate the exact active UserRunner write fence at its owning Cloudflare route before the read or effect. The fence binds the claimed member, attempt, and lease generation; a bound-user header or Cloudflare container id is not authority. Runtime transports and operation-specific clients attach the current lease without introducing a second identity source. The pre-binding container-fatal sink remains the sole log-only exception.
- Cloudflare hosted provider credentials for intercepted OpenAI, ElevenLabs, xAI, Exa, Mapbox, Linq, Telegram, hosted data API, and Workers AI transcription egress must remain Worker-owned. Native child-process integrations for OpenAI, Exa, Mapbox, `murph_data_api`, and `workers_ai_transcribe` receive only a runner-scoped signed Murph provider credential in the provider's native credential slot; the Worker verifies `provider + user + runner`, requires UserRunner to report an active runtime for the same user/runner/provider, applies the provider request policy, and only then injects the real Worker-owned credential. That signed credential is identity, not standalone spend authority, and its signing secret must never be forwarded into hosted runtime env. Runtime-controlled provider calls may instead carry exact write-fence headers or a provider-egress token. A bound user or container identity alone is not provider authority. Delivery providers (Linq and Telegram) and ElevenLabs must continue to require exact write-fence headers or a provider-egress token; those auth proofs are attached only by the runtime's wrapped fetch, which routes through the outbound-intent journal that owns recipient binding and idempotency. The injected-credential sentinel is a known literal that any in-container process can reproduce, so it must never authorize wrong-recipient, duplicate, or destructive messaging mutations by itself. Codex-native managed OpenAI search is restricted to exact `POST /v1/alpha/search` under the same provider/user/runner credential validation and upstream-header stripping as core OpenAI inference; no other OpenAI search method or path is admitted. The reviewed Codex route inventory is a test-only upgrade gate, not a production policy owner: new binary candidates fail CI until classified, and no manifest or scanner may auto-admit provider egress. ElevenLabs egress is restricted to bounded MP3 text-to-speech requests; xAI egress is restricted to bounded `POST /v1/responses` requests carrying exactly one `x_search` server-side tool entry with handle/date filters, documented boolean image/video-understanding flags, and storage disabled; successful responses start best-effort post-hoc recording of the provider-reported exact cost (`usage.cost_in_usd_ticks`) off the foreground reply path, failed provider calls are never billed, a Murph-side accounting outage can leave a completed call unbilled, and the trusted per-turn call ceiling bounds spend; Exa egress is restricted to `POST /search` with the exact bounded `research scout` request shape, `research paper` category, a caller-supplied publication window (the Worker enforces well-formedness only: `since < until` and `until` not in the future beyond a small clock skew), and a focused or legacy-batch query whose profile values all belong to the finite server-owned concept set before canonical reconstruction and credential injection; Linq egress is restricted to the runtime read/send/voice/reaction/typing/read-receipt/message-cleanup route matrix documented in `apps/cloudflare/README.md`; Mapbox remains restricted to read-only GET allowlisted path families. While hosted-agent arbitrary internet egress remains enabled, unclassified outbound requests are an explicit open-internet passthrough mode: they must strip runtime authority headers and must not receive Worker-owned provider credentials.
- A hosted custom-inference connection is a singular personal-member secret
  encrypted by Web under the dedicated control-domain secure-box lane. Web may
  replace it only after synthetic streaming and tool-loop verification succeeds;
  failed verification preserves the prior row. Runtime preparation resolves the
  exact selected revision once, and Cloudflare binds a context-separated
  encrypted target envelope to the existing active UserRunner fence. The runner
  and Codex config receive only a fixed provider, opaque model alias, non-secret
  sentinel, and provider-egress authority; endpoint URL, upstream model, and
  credential must not enter runner env, shell env, workspace state, prompts, or
  logs. Runtime egress must validate the active fence before opening the envelope
  and must never fall back to a managed provider.
- Custom-inference egress accepts only an exact public HTTPS DNS operation URL
  on port 443, follows zero redirects, has no private-network/VPC binding, strips
  caller authority and forwarding headers, and injects exactly one fixed-shape
  bearer, `api-key`, or `x-api-key` credential. It rejects IP literals,
  localhost and internal synthetic hosts, URL credentials, unexpected query
  parameters, unsupported images or tools, oversized requests/events/errors,
  malformed streams, and stale invocation authority. Diagnostics may include
  only bounded protocol, revision/profile, duration, status family, and safe
  error categories; never request/response bodies, full URLs or query strings,
  raw upstream errors, auth headers, or decrypted envelopes.
- The hosted `murph.submit_product_feedback` dynamic tool is a model-controlled intake surface for product feedback only. Expose it only for hosted provider requests with accepted user-authored assistant input, and use it only after explicit product frustration, a feature request, product interest including shipped changelog items, clear inferred workflow friction, or repeated Murph-observed product/tool friction. The payload must stay to allowlisted feedback kind, a concise bounded de-identified product-only summary, plus optional server-validated changelog ids. The summary must abstract private context to the least-specific product concept needed for triage and must not store health data, health values, diagnoses, medications, raw user wording, raw conversation or voice-memo content, names, handles, user or account identifiers, contact details, locations, relationships, secrets, provider payloads, tags, topics, or unrelated context. Shared parsing and web persistence must apply the shared deterministic redaction pass for high-confidence contact, identifier, network, secret-shaped, and common exact-health-value patterns before recording. That pass is best-effort defense-in-depth over recognizable shapes, not a semantic guarantee: a summary written in violation of the model-facing contract can retain a sensitive value the patterns do not recognize, and the repository owner has explicitly accepted that residual risk for anonymous free-text rows instead of requiring a fail-closed semantic boundary that would drop or truncate feedback. The primary privacy boundary for summary content is the model-facing contract above; the scrub is never permission to send raw sensitive text, and new patterns should be added only for recurring high-confidence shapes rather than chasing every natural-language spelling. Cloudflare may reach the web recording route only through the signed web-control callback allowlist. The callback-bound member authenticates and authorizes the write while Web owns linkage: an ordinary private-direct row may retain the authenticated member, a synthetic group row stays anonymous, and the model/runtime payload cannot select linkage. `member_id` remains nullable and server-controlled, and new deterministic feedback ids must not encode member identity. Response surfaces should return only opaque feedback ids plus recorded/dedup status.
- Tool authority for the reserved support-escalation shape exists only for an explicit Murph human-support request in a verified private direct conversation. That request authorizes one account-linked call whose summary begins with the exact reserved prefix and continues with Murph's concise, bounded, de-identified product-only explanation in its own words. The model-facing contract forbids copied or quoted conversation text and every private category forbidden for ordinary feedback; shared parsing and Web persistence apply the same deterministic sanitizer before recording. The linked marker remains fixed server-authored metadata while the explanation is stored in a separate anonymous detail row. The explicit human-support request also authorizes the paired Web owner to disclose that sanitized explanation beside the internal member id to the dedicated support recipient. This intentionally accepts the same residual semantic-redaction risk described above for the explanation while never treating raw conversation text as disclosure authority. The anonymous explanation also enters the configured general product-feedback digest without the linked marker or member id and follows ordinary anonymous-feedback retention after account deletion; the linked marker is deleted with the account. Those existing audience and retention owners preserve de-identified product triage without adding another state or lifecycle path. Every value under the exact reserved prefix must enter the support owner; empty, wrong-kind, changelog-linked, group, and unverified shapes fail closed before persistence. A generic bug handoff does not authorize the reserved shape. The support address remains opt-in and appears only when explicitly requested.
- The reserved verified-private support-escalation shape is the narrow internal-email exception to ordinary feedback disclosure. Web persists one fixed server-authored member-linked marker and one anonymous row containing only the prefix-stripped sanitized explanation, then may pair that read-back explanation with the callback-bound member id and internal feedback id in the immediate support alert. Both rows must validate before provider entry. Replay treats the first stored anonymous explanation as authority and reproduces the same body and provider idempotency key even if a later callback rewords the issue; missing, member-linked, empty, unsanitized, overlong, or still-prefixed stored detail fails before Resend. The alert remains plain text, fixed-recipient, daily-capped, and forbidden from including raw or quoted member text or any private category prohibited by the model-facing contract. The explicit request authorizes only Murph's sanitized de-identified product explanation beside identity, with the same documented residual semantic-redaction risk; it never authorizes transcript disclosure.
- The internal product-feedback digest may disclose only the fixed
  server-owned kind labels, truthful grouped per-kind counts, and the
  capture-scrubbed de-identified product-feedback summaries of the three
  allowlisted product-feedback kinds to the dedicated configured operator
  recipient list through the existing Resend transport. The disclosure
  boundary for summary text is the capture side: the recording path stores
  only a bounded de-identified product-only summary written under the
  model-facing contract and passed through the shared deterministic redaction
  pass, so the digest renders stored summaries verbatim and adds nothing else.
  Its bounded, deterministically ordered row query must select only the kind
  and summary columns, its count aggregate groups only by kind, and neither
  may read any member identifier, internal feedback id, changelog metadata, or
  any other private row content. The cron route must retain the shared
  timing-safe Vercel bearer check before any database read, missing
  configuration must fail before that read, and recipient addresses must
  remain environment-held and absent from logs.
- The hosted `murph.personalization` dynamic tool is a callback-bound current-runtime tone/voice control surface. Expose it only when the active hosted execution context carries the dedicated personalization port; planning may register it for a private direct turn or an authenticated hosted Linq group turn, never for group email or an unverified audience. Do not route it through the shell-facing CLI or add a second authority token. Cloudflare must validate the active runtime write fence before forwarding its signed `web-control.worker` callback, forward the validated fence headers, and sign only the fence-bound runtime member; missing, stale, wrong-generation, or cross-member fences fail closed. In a direct runtime that member is the person. In a hosted group it is the synthetic thread container, never the current speaker or another participant. The runner commit timeout must exceed the web-control timeout by at least five seconds so a committed personalization change cannot be reported as an ordinary outer timeout. New conversation mailbox rows may persist only a nullable server-keyed lookup of their existing deterministic assistant input id as operational metadata; do not persist the raw id there or change the mailbox wire contract, `sourceRef`, or event id. For an update, the runtime forwards only the terminal input id from a locally revalidated, bounded exact-successor provider batch instead of forwarding a numeric sequence. Inside the mutation transaction, web must derive every configured lookup-key version from the callback id, bind the callback runtime member and one matching key to one live conversation-lane `conversation.message` row, and derive the canonical causal sequence from that row. Missing, legacy, mismatched, or ambiguous identity must fail closed; neither a model-supplied nor runtime-supplied sequence or member id is an accepted fallback. For a synthetic thread container, web must also prove that the exact input is a non-direct Linq wake with present, current route authority whose thread and container both match that callback member; email, direct, missing, stale, or cross-room authority fails closed. The web callback must recheck the participant-aware canonical hosted-runtime access gate at the read/write boundary, strictly reject unknown or empty update fields, and accept only shared tone/voice enums. Results may return only effective tone/voice enums, read-only model and Sol-availability context, literal-false model-change fields, and saved/unchanged status; they must not expose billing records, participant identity data, mailbox contents, vault state, secrets, or provider errors. Model and reasoning mutations remain exclusively owned by `murph.assistant_configuration`, which uses the same terminal-input authority for eligible member-bound direct updates without passkey approval and remains unavailable in groups. Generic callback failure must remain generic and must never be presented as evidence that a member lacks Edge access.
- A person-runtime assistant-style update must prove that its exact accepted wake is direct: Linq must be explicitly direct, email must be explicitly direct and style-authorized, and the hosted Telegram person route remains direct-only. This positive check prevents a retained or mislabeled non-direct input from falling through to private preferences when no thread-container row exists.
- Participant-derived thread-container authority is leased, not permanent. Every access, AI-allowance, usage, and newsletter read must use the shared seven-day `lastSeenAt` predicate with `removedAt: null`. Ordinary authenticated Linq inbound may renew only an existing relationship for the currently resolved hosted identity; it must not create a participant row, clear a removal, move `lastSeenAt` backward, or accept a provider timestamp later than server time. Before denying an expired route, Web may read the full current provider roster. That authoritative path may create or reinstate exactly the current authenticated sender only after the roster contains the normalized contact, the contact re-resolves to the same active hosted identity, and the canonical participant row is upserted; other roster candidates remain update-only and must re-resolve to their existing member. Display handles, roster order, and the assistant participant cap are never authority.
- Hosted `murph.assistant_style` mutations may use a numeric sequence only after
  the signed Web personalization port binds the terminal provider-accepted input
  id from a locally revalidated exact-successor batch to the callback member and
  one live mailbox row at mutation time. Persisted
  model-writable assistant-input state is never authority; missing or ambiguous
  authority must fail the hosted mutation closed without blocking the ordinary
  reply. The callback's runtime member is also the only style owner: a direct
  turn targets the person runtime, while a group turn targets the synthetic
  room runtime and must never resolve the visible sender to a private member.
- The hosted `murph.create_phone_call` dynamic tool is a model-controlled side-effect surface for user-approved outbound phone calls only. Expose it only when the hosted runtime has the web-owned phone-call port, require a bounded E.164 destination plus compact call brief, and put only user-approved disclosable facts in `shareableFacts`. Cloudflare may reach only the signed web-control callback allowlist entry for `POST /api/internal/phone-calls` with runtime write-fence authority; `apps/web` owns the Retell API key, from number, agent id/version, verified member transfer-number resolution, member-bound `HostedPhoneCall` rows, and request-key idempotency. Retell may receive the bounded call brief as dynamic variables and may call only signed raw-body `ask_murph`, `call_ended`, and `call_analyzed` routes; Murph must not persist raw Retell transcripts, Retell request/response bodies, provider secrets, or call audio in logs, docs, fixtures, workspace state, or user-facing output. Store only the bounded call brief, exact initiating resident-session id, provider call id, status, and final analysis result needed for member-bound retry/audit. Encrypt every newly written brief and result before persistence through the control-domain `hosted-member-private-field` secure-box lane with member/table/row/field/scope-bound AAD, never dual-write plaintext, prefer ciphertext on reads, and fail closed when a present ciphertext is empty or invalid. A completed analysis persists the encrypted result and appends an `assistant.notification.requested` event that resolves the member's messaging route at completion time and delivers one model-composed result message, idempotent on the deterministic `phone-call-result:${callId}` key; Murph may skip a result with nothing meaningful to report. The output-only notification turn treats provider and callee text as bounded untrusted data, never authority, exposes no tools, and includes no conversation history or private context. The persisted initiating-session id is used only for phone-call request-key idempotency, never as a delivery route. For a group call, Web reloads the exact selected accepted message, binds it to the callback channel, account, thread, and synthetic container, derives the participant from that server-owned evidence, requires one current joined unsuspended membership, and repeats the same authority check immediately before provider start; the existing request-key calculation does not change. Account deletion must process every retained Retell provider call id, stop active calls, delete each provider object, and clear the local id only after confirmed deletion or confirmed absence. Any ambiguous provider or local-write failure must keep the `HostedPhoneCall` row and provider id as retry ownership and block the destructive local account transaction; terminal call status must not exempt provider cleanup. Retell API-key rotation must remain within the same Retell workspace while durable call ids exist, because the provider's missing-asset response proves absence only within the workspace authorized by the current key. Nullable `brief_json` and `result_json` are migration debt only: the bounded operator backfill must prove replacement equality, update under full compare-and-set authority, scrub plaintext in the same write, and emit metadata counts only.
- The mechanical private-storage field-classification guard currently covers `HostedPhoneCall` only. It is not evidence that every other Prisma model has completed the same field-by-field audit; extend or add an owner guard when another private-content model is materially changed.
- Kernel browser automation is an `apps/web`-owned hosted control surface. `KERNEL_API_KEY` must stay in web environment configuration only and must not be forwarded into Cloudflare runner env, Codex prompts, dynamic tool payloads, logs, fixtures, or user-facing output. Cloudflare may proxy only the narrow signed `/api/internal/computer/**` routes through `web-control.worker`; it must not receive raw Kernel API credentials or raw live-view URLs.
- The persistent Kernel profile requires `HOSTED_COMPUTER_PROFILE_NAMESPACE` in `apps/web`; set it to a stable value per trust boundary so production, previews, and other deployments do not share saved cookies or authenticated browser state. Keep production's namespace stable, and use branch/deployment-specific preview namespaces or disable the persistent computer-use profile outside production.
- Kernel Managed Auth is an `apps/web`-owned credential boundary. The model may select `managed_login`, but it receives only Murph's short-lived member-bound handoff URL; raw Kernel Hosted UI URLs, auth connection ids, handoff codes, Managed Auth live-view URLs, discovered fields, MFA targets, credential references, website errors, and provider error bodies must stay out of prompts, tool results, logs, analytics, fixtures, and workspace state. Managed Auth Hosted UI redirects must fail closed to Kernel's exact hosted-auth origin before Murph appends callback URLs. Managed Auth connections are durable per member profile and domain with credential saving, health checks, and automatic reauthentication enabled and session recording disabled. When Managed Auth startup fails after the task browser can be restored, web atomically converts the same short-lived member-bound handoff to the existing `login` Live View purpose instead of releasing and replacing the checkpoint or keeping the member in a managed retry loop. That conversion must serialize against the member's conversation-mailbox ordering row, then persist the current mailbox lane sequence in the run's explicit nullable resume-boundary field in the same transaction. The reconciling `computer_open` request must remain awaiting, so the mailbox item that discovered the provider failure cannot also consume the new Live View checkpoint; only a conversation item with a higher lane sequence may resume it, regardless of transaction timestamp order. Timestamps remain audit metadata and must not classify fallback ownership. Unmarked direct-login and pre-migration rows retain the existing timestamp reply proof during the bounded active-run drain; do not infer or write a sequence marker from mutable handoff timestamps. Dispatching provider startup is effect-ambiguous even when the first current-flow lookup is empty; keep the handoff checkpointing until provider ownership is proved terminal instead of publishing a fallback writer. Browser publication and handoff conversion or completion must commit in one transaction. If both idempotent terminal-write attempts return an error, treat the outcome as unknown and keep the handoff checkpointing; do not provision or delete another task browser until durable state is reread or the stale claim is safely reclaimed. Every nonterminal `managed_login` row remains owned by the provider-aware controller even when its inter-request claim is yielded to `open`; generic completion and open/resume paths must not replace, terminally expire, release, or resume it, and read-only failures or nonterminal observations after reclaiming a request-local claim must yield that claim. `computer_open` must invoke provider reconciliation before any generic resume authority and must stay awaiting while the provider is in progress or unknown. Client-link expiry revokes the capability without terminally expiring provider-owned work; repeated pause may rotate only an idle/open or stale-recovery row's token hash and link expiry, invalidating the earlier token while preserving its id, immutable creation boundary, and mutable claim-lease timestamp. A fresh controller claim keeps its token stable so concurrent recovery cannot invalidate the callback URL being returned. Only provider-aware reconciliation or run-terminal cleanup may dispose of the Managed Auth browser and close the row. Before run-terminal cleanup reads or deletes the connection's shared current browser, it must acquire an exact-CAS `cleanup_pending` run fence under an identity-only member lock. Cleanup must remain available when the member is suspended without granting foreground computer use; foreground admission keeps the suspension-aware entitlement lock. The cleanup fence blocks replacement-run admission regardless of run expiry; only a stale exact-CAS cleanup lease may reclaim it, and unrelated finish requests must not clear it. Provider-flow correlation must use the handoff's immutable creation boundary, never the mutable claim-lease timestamp. Reconcile a partial detach before trusting a stored browser capability. If provider reconciliation cannot prove that no Managed Auth browser owns the profile, do not publish another profile writer. A final failure page rendered while the claim is fresh must not call the Managed Auth controller again; it may offer only a safe return to Murph. Final failure diagnostics may persist only fixed-vocabulary stage and internal error-code metadata plus URL-validation booleans; they must not persist handoff tokens, domains, connection ids, provider payloads, or browser capability URLs, and their writes must stay off the user-visible retry path. The existing `login` purpose remains direct Live View takeover. Only one profile-writing browser may be active during either transition, and account deletion must delete every Managed Auth connection before deleting its Kernel profile.
- Hosted computer-use run rows may persist Kernel browser/session ids plus encrypted live-view URLs. Live-view URLs are secret browser capabilities: store them only through the hosted secure-box lane, never log or return them through Codex dynamic tools, validate their origin against Kernel's documented live-view origin policy, and expose them only through a short-lived handoff page guarded by the member's first-party hosted app session and a stored token hash. Handoff tokens must be high-entropy, stored only by hash, expire quickly, and never grant access across members.
- `computer_open` is the single hosted browser entry primitive. It creates, reuses, resumes, or safely reclaims the member's active Kernel-backed run through signed computer-use callbacks, then returns sanitized current page URL/title plus visible page text to the trusted model without heuristic text redaction so the browser primitive remains usable. Reclaiming an `awaiting_user` run is server-owned: the web service selects the active member run, uses hidden hosted mailbox/delivery-context proof when present, may resume a completed handoff or stale checkpointing recovery, and must not accept model-provided run ids, confirmation text, or resume evidence as authority. Open or expired handoffs, fresh checkpointing handoffs, and browserless Managed Auth transitions remain locked until the web-owned handoff flow finishes, expires through the normal recovery path, or matching hidden reply proof is supplied. `computer_act` is a bounded raw Playwright execution primitive that runs inside the same web-owned Kernel browser session. The service keeps member/run/session authorization, request signing, timeout caps, URL/title/result capture, display-cache sanitization, and redacted Kernel failure diagnostics, but it does not pretend to sandbox individual Playwright APIs or enforce a browser network policy. Because `page`, `context`, and `browser` are available to the trusted model, any hard private-network or protocol enforcement would need to live below Playwright. `computer_os_control` is a bounded fallback that maps one validated mouse or keyboard action to Kernel computer controls through the same signed callback path; it must not expose screenshot capture, clipboard read/write, cursor introspection, raw Kernel handles, raw Kernel API credentials, browser cookies, storage state, live-view URLs, or typed text in tool results or runtime logs. Policy and skill instructions must tell the model not to query or return cookies, storage state, local storage, hidden browser credentials, raw Kernel capabilities, live-view URLs, passwords, payment details, one-time codes, raw tokens, or similar secrets. Sensitive user input should pause for handoff instead of being serialized into Playwright source or OS-control text. `computer_pause_for_user` remains the durable human checkpoint primitive for missing user input or direct takeover. It must not send a separate user-visible message; it must mark the run `awaiting_user` with the reason, pending handoff, hidden delivery context, and last known URL/title before returning structured pause details to the model. A returned member-gated `handoffUrl` remains available in the normal tool result so the model can include one natural link when the user needs it; the runtime must not append a second handoff block, and `finish_without_reply` remains unavailable after a successful pause. Raw Kernel live-view URLs must remain hidden. Legacy pause request `message` fields may be accepted during deploy skew only and must be ignored, not persisted or sent. Same-turn computer tools must stay locked after a pause request.
- Hosted audio transcription is a Worker-owned Workers AI effect. The hosted runtime may send only audio attachment bytes to the fixed `murph-transcribe.worker/v1/transcribe` host: either ffmpeg-prepared audio (16 kHz WAV for local whisper compatibility, or remote-only 64 kbps MP3 after `-vn` sanitization with metadata/chapter stripping), or — when remote transcription is the only transcription lane — the original audio attachment in a conservative remote-verified audio format with matching MIME, container signature, and byte cap. Passthrough originals may carry container metadata such as device tags, and their duration is bounded only by the byte cap; known video-capable or container-ambiguous MIME/container signals like `.m4a`, `.mp4`, `audio/m4a`, `audio/mp4`, `audio/ogg`, `audio/opus`, and `video/*` stay on the ffmpeg `-vn` path rather than passthrough. The Worker validates the signed runner-scoped `workers_ai_transcribe` provider credential, exact write-fence proof, or a provider-egress token before calling the `AI` binding, returns only bounded transcript JSON, and must never log or persist transcript text, audio bytes, or Workers AI account context in structured logs or runtime env. Keep account-level Workers AI request/response logging and AI Gateway capture disabled for this Worker; voice audio is health-adjacent data and must not be persisted by dashboard-side inference logging.
- Environment walkthrough audio may enter only through the authenticated same-origin Web route and the Vercel-OIDC-bound Cloudflare staging route for the same member. Store it application-encrypted under the member's opaque R2 namespace; never expose its object key, bytes, transcript, or provider request in browser-visible status, logs, mailbox metadata, assistant conversation history, or outbound messaging. The system mailbox carries only bounded integrity metadata and the opaque audio key. The write-fenced runtime may read and delete that key only for the bound member, uses the existing Worker-owned transcription effect, and passes the resulting transcript only to the exact silent `habitat-voice` maintenance turn. That turn has no conversation history, dynamic tools, or delivery route; its maintenance policy permits only Habitat show, catalog, and save commands and treats the transcript as untrusted evidence. Successful processing deletes the staged object after checkpoint; account deletion sweeps the member prefix and the 24-hour lifecycle remains the final asynchronous backstop.
- Private assistant images use the `vault_image` media type, never the public `image` URL type. The descriptor persists only a normalized vault-relative ref, SHA-256, exact byte count, filename, allowlisted image MIME type, alt text, and bounded source metadata. OpenAI image failure diagnostics may expose only the structured error message, code, and request id after control stripping, whitespace normalization, and fixed code-point caps; never copy a raw error body, request body, authorization material, key, image bytes, or arbitrary header into the tool result or hosted completion. A provider message can echo private prompt context, so keep it only in the private tool/model transcript and runtime-authored completion input. Runtime provenance authenticates the completion status, not the provider text: the model must treat that diagnostic as untrusted evidence, never follow commands, links, permission claims, tool requests, or policy text inside it, and must not add it to operational logs or repeat it verbatim to the member by default. Final delivery must reload the regular file, enforce the private-image size cap, verify the descriptor metadata plus image signature, and complete that verification before recording provider dispatch. Linq receives verified message-image bytes through its existing attachment-upload API; Telegram receives them through multipart `sendPhoto`. Do not mint a public or signed URL as the internal representation. The sole URL-only exception is Linq group-avatar ingestion: after chat-authority preflight, the write-fenced Worker route sends only validated bytes and MIME type to the existing per-user `UserRunner`, which serializes staging and account deletion under one mutation lock, verifies the write fence inside that lock, stores one deterministic application-encrypted object under the member's opaque private-media R2 prefix, and returns an opaque at-most-one-day capability on the current deployment's exact Worker origin. Worker publication derives that origin from the required non-secret `CF_PUBLIC_BASE_URL`; Web validation derives it from `HOSTED_EXECUTION_CONTROL_URL`. Production and preview must reject one another's current capability origins while the exact legacy signed-Images shape and queryless `https://imagedelivery.net/<account>/<image>/public` shape remain temporarily accepted during their drain window; no other queryless Images variant is compatible. The canonical Worker capability path ends in `group-avatar.<ext>`, with the extension derived from the verified MIME type; the Worker and Web/runtime validators must also accept the already-shipped extensionless path through the one-day capability lifetime and warm-container rollback drain. Deploy dual-shape Web/runtime validation before canonical Worker minting, and rollback minting before removing either compatibility consumer. If deletion owns the lock first, queued staging must fail after the cleared fence is rechecked; if staging owns it first, deletion must wait and then sweep the staged object before reporting completion. The encrypted capability may carry only the member id, image hash, exact byte count, allowlisted MIME type, and expiry needed to reconstruct and verify that object; none of those fields, the R2 key, or the storage namespace may appear in the URL or logs. The public GET/HEAD route must accept only those exact capability shapes, return matching successful content headers with an empty HEAD body, reject an extension that disagrees with the decrypted MIME type, fail closed on expiry, tampering, extra query parameters, missing bytes, decrypt failure, size/hash mismatch, or image-signature mismatch, and return `private, no-store`. A retry must reuse the deterministic object only while its original R2 lifecycle window remains and must cap capability expiry at that boundary. At or after the boundary, the mutation-locked `UserRunner` must replace the same deterministic key before returning a newly bounded capability, so no capability outlives the object lifecycle window it names. Account deletion must make the existing bounded Cloudflare cleanup attempt before acknowledging completion; success synchronously sweeps the prefix, while timeout or provider failure leaves the encrypted receipt and retention cron as retry ownership. The R2 lifecycle makes a staged object eligible for asynchronous deletion after 24 hours and is not a physical-deletion deadline. Provider acceptance or fetch timing is never deletion authority. The URL must never enter model output, response media, or assistant outbox state. A non-2xx Linq avatar response may expose only an allowlisted documented nested four-digit provider code; the strict hosted-execution parser derives the fixed first-party recovery text. Provider prose, raw bodies, trace ids, headers, and transport or timeout errors remain outside the tool result. The legacy write-fenced `results.worker/generated-images` endpoint remains a `410 Gone` tombstone, and the exact signed and queryless-public Images URL shapes are accepted only as rolling-deploy compatibility inputs while old producers and rollback candidates drain.
- A Linq nutrition card's static `image_url` is message presentation, not an authority capability or the internal representation of a private assistant image. It reuses the bounded V1/V2 snapshot already allowed in the private-direct message, but path encoding is not encryption: Vercel and Linq can observe those values. The path must be queryless and contain no member identity, conversation or canonical record reference, credential, signature, or other authority. The Web `ImageResponse` route must validate an exact canonical Base64URL envelope before reading local render assets, perform no database or remote read, emit no application logs or analytics, and return `private, no-store` plus `noindex`. Do not place the URL in analytics, durable diagnostic artifacts, or model-authored content. Linq may fetch and rehost the resulting image; neither fetch timing nor provider acceptance grants application authority.
- Hosted generated voice memos are Worker-mediated ElevenLabs plus channel-native delivery effects. Store only bounded transcript/config metadata plus Linq attachment references or Telegram delivery-time generation references in assistant runtime/outbox records; never write generated audio bytes, ElevenLabs request text beyond the intended transcript field, provider secrets, presigned upload headers, or Telegram multipart audio bodies into logs, docs, fixtures, or user-facing output.
- Hosted snapshot path diagnostics may use a Worker-derived HMAC key from `HOSTED_LOG_FINGERPRINT_SECRET`, passed only through the runner job diagnostics object for metadata-only path hashes. The container CPU watchdog may log only PID, numeric CPU attribution, and a fixed-allowlist executable basename derived from `/proc/<pid>/exe`, with an allowlisted Linux `comm` value as the readlink-unavailable fallback. A successfully read non-allowlisted executable never falls back to `comm`; arbitrary `comm` values and the symlink target path are never retained across samples or logged. It must not log command lines, argv, file paths, prompts, request bodies, transcripts, vault contents, or a Worker fingerprint secret. Do not put the raw Worker fingerprint secret or raw `HOSTED_LOG_FINGERPRINT_SECRET` env key in forwarded env, platform env, user env, hosted runtime env, logs, container env, or persisted artifacts.
- The container fatal-report sink (`runner-control.worker/v1/container-fatal`, handled in `apps/cloudflare/src/runner-egress-intercept.ts`) is deliberately reachable without a bound user or write fence: the unattributable container deaths it exists to record happen outside any invocation, when neither exists. Its only effect is a sanitized, size-capped, per-isolate rate-limited worker log line; it must never forward to the Durable Object, never inject credentials, and never persist beyond worker logs. Any code running in a hosted container can post to it, so treat its log lines as container-asserted diagnostics (correlate with DO lifecycle stop events), not authenticated facts.
- Linq group-icon outcome observability may retain only bounded identifier suffixes, a blind chat lookup key, terminal status and timestamp, payload shape/hash, and the documented numeric failure code. The accepted-request log and durable outcome row must never retain the old or new icon URL, changed-by handle, raw callback values, or provider prose.
- Crabbox verification is a secret-free trust boundary, not a deployment lane.
  The local dispatcher must rebuild the Crabbox CLI environment from non-secret
  host/config paths instead of passing through the parent environment and use
  that exact scrubbed environment for every Git sync-guard subprocess.
  Both remote providers must reject untracked, partially staged, conflicting,
  sensitive, or private sync candidates before transport, forward no
  environment allowlist or SSH agent, and enter the same deterministic
  synthetic test environment.
  Static SSH must use only validated operator-local host, user, and port routing,
  a dedicated standard macOS account with no personal, product, cloud, Keychain,
  `.env*`, or Full Disk Access authority, an isolated opaque workspace per
  invocation, and full resync. The host must resolve independently of an
  SSH-config-only alias so Crabbox's raw readiness probe and SSH transport select
  the same machine. Routing values may enter only as Crabbox CLI arguments, not
  the rebuilt CLI environment or the remote test environment. A mutable-checkout
  preflight may fail fast, but remote
  admission, sensitive-path checks, logged tree proof, and executed bytes must
  derive from one frozen Git candidate. Materialization must preserve the
  captured base as detached `HEAD` with that candidate staged so implicit diff
  selection remains intact without depending on a local branch. Crabbox excludes
  `.git`, so the dispatcher may add only generated base-tree/object metadata
  after candidate admission. Before inspecting that metadata or starting any
  candidate-controlled install or verification, the remote entrypoint must use
  only its rebuilt non-secret environment to prove `tar` and a bounded `zstd`
  stdin round trip with the production snapshot arguments; missing,
  incompatible, or corrupt behavior fails closed without copying stderr or
  ambient environment data into diagnostics. Only then may it move the metadata
  out of the worktree, reconstruct detached `HEAD`, and verify both admitted tree
  ids. The same entrypoint must stamp the `static-ssh` verification profile
  internally after discarding caller profile and worker-tuning values. That
  profile may derive a bounded composed plan only from generic locally observed
  CPU and physical-memory capacity; routing values, machine labels, and caller
  tuning must not influence it. The local artifact lock protects cooperating
  local producers and candidate capture only.
  A native macOS `lockf` descriptor inherited by the remote verifier is the sole
  static-worker capacity authority; its path must resolve above Crabbox's nested
  lease/repository directories so every run contends on the same kernel lock.
  The verifier must retain it through exact child-group cleanup and delete only
  its exact outer run directory.
  Candidate code has arbitrary execution authority within that account, so a
  personal or credential-bearing account is never an acceptable worker.
  The Blacksmith workflow must retain read-only repository contents permission,
  no GitHub Environment, no OIDC permission, no Actions-secret references, and
  pinned actions. The dispatcher must pin the Blacksmith organization,
  default-branch ref, workflow, and job before each fresh canonical Testbox is
  created instead of trusting mutable local profile/config values or an
  arbitrary reusable lease. Before candidate sync can execute repository code,
  the default-branch workflow must install the trusted verification shell as a
  root-owned file outside the workspace; canonical delegation invokes that
  absolute path, which validates the two allowed commands and directly `exec`s
  the candidate verifier through `env -i` with an isolated temporary home and a
  one-bit trusted-entry marker. The candidate verifier must fail closed without
  that marker and then call the shared sanitized core. A change to the workflow
  or trusted entrypoint cannot use the not-yet-landed trust root for proof:
  verify it locally, land it through the protected workflow-change path, then
  run a post-landing remote proof. Never treat either boundary as a sandbox for
  a compromised initiating account; any process that can already read a
  production secret and make arbitrary network calls can exfiltrate it without
  Crabbox.
- GitHub production credentials must be environment-scoped, with the production environment restricted to protected branches. Do not retain duplicate repository-scoped copies: a write-capable workflow author can explicitly reference repository secrets from another workflow/ref without using the production environment. Every production job must attach the production environment before referencing its credentials. Prefer required reviewers when a second trusted operator is available; branch policy alone does not defend against an account that can administratively bypass or change the repository rules.
- The public automated live Junction wearable canary uses only sandbox Junction
  authority and a dedicated WHOOP test account. Keep those four credentials
  exclusively in the `junction-wearable-canary` GitHub Environment, restrict it to
  protected `main`, and never duplicate them as repository secrets. The
  `JUNCTION_CLIENT_USER_ID_SECRET` is Murph-owned rather than Junction-issued:
  generate it once with a cryptographically secure random source, keep it
  stable, and treat rotation as an identity remap that requires deliberate
  cleanup of the prior derived Junction users.
  The workflow may run only after a push to protected `main` or by manual dispatch
  from protected `main`, with read-only repository permission and one
  non-canceling concurrency slot.
  Credential references belong only on the final hosted-local execution step;
  checkout, dependency installation, bundle assembly, browser installation,
  logs, and artifacts receive none. The canary must remain Junction-sandbox
  only, upload no screenshots, traces, videos, provider pages, or hosted-local
  state, pass only one provider login to the browser at a time, and perform
  bounded provider-specific deregistration before and after each proof.
  Oura web authentication requires a fresh emailed one-time code, so its live
  Junction browser proof is operator-run and headful rather than an unattended
  GitHub canary. It accepts the dedicated Oura account email only, waits for
  manual code entry without persisting the code or a password, and retains the
  same credential partitioning, artifact prohibition, and cleanup boundaries.
  Retain the retired `MURPH_E2E_OURA_PASSWORD` name only in scrub lists so a
  stale operator-shell export cannot reach preparation, runtimes, or Chromium.
  Because a newly added workflow is not yet a protected trust root, its first
  credentialed proof occurs only after that exact workflow lands on `main`.
- Cloudflare hosted deploys intentionally run the manual predeploy gates, hosted Codex auth guard, production build prep, Wrangler deploy, and deployed endpoint smoke on protected-main Blacksmith runners. Treat that as the only approved Blacksmith production-secret trust expansion: keep the workflow protected-main-only before environment attachment, scope production secrets to the validation, render, deploy, and smoke steps after checkout verification, and do not move any broader production secret access to Blacksmith without a fresh security review and durable docs update.
- The same protected-main Cloudflare workflow may attach the GitHub `Preview`
  Environment only for the explicit `preview` target. That environment must
  contain staging-only credentials and must not duplicate production database,
  crypto, callback, persistent-browser, messaging, or state-bearing provider
  authority. Preview deploy context, Vercel OIDC environment, and hosted crypto
  environment must agree; Worker/R2 names and Worker/Web origins must be
  visibly preview- or staging-scoped, and the preview Web origin must differ
  from the declared production origin. These checks must run before render,
  secret sync, lifecycle mutation, or deploy. Production credentials remain
  accessible only through the production environment.
- The Render Temporal worker deploy hook belongs only in the private
  `cobuildwithus/murph-cloud` protected GitHub production environment as the
  `RENDER_TEMPORAL_WORKER_DEPLOY_HOOK` secret, never at repository scope, in
  this public repository, or in repo files/logs. The private post-CI deploy job
  must attach that environment and may call the hook only for the exact current
  protected `main` commit after required push CI passes.
- Resend-backed hosted signup welcome email must keep `RESEND_API_KEY` and sender identity in environment variables only, send a plain-text-only body, claim the durable per-member welcome-attempt marker before the provider call, keep the stable per-member Resend idempotency key as provider replay defense only, and log only sanitized provider metadata such as status/code. The optional internal signup notification must also keep recipients in environment variables only, use a plain-text-only body, claim its own durable per-member attempt marker before the provider call, keep a separate stable per-member Resend idempotency key as provider replay defense only, and log only sanitized provider metadata. Resend-backed subscription cancellation feedback email must use the same env-only API key/sender configuration, send plain text only, rely on the existing Stripe event receipt for retry ownership until completion, store a receipt-local sent marker only after provider success so later receipt retries do not resend, use a subscription-scoped Resend idempotency key as provider replay defense, and log only sanitized provider metadata. A Stripe-collected checkout email may be stored only as an encrypted unverified email hint plus transactional welcome and cancellation-feedback recipient; do not use it for hosted account lookup, direct-public sender authorization, direct-public start instructions, or email-linked channel state until Privy verifies it. Later successful Stripe payments must not re-run activation welcome side effects.
- Resend-backed Stripe failure alerts must use only the environment-owned shared
  operational sender, recipient allowlist, and API key. Their plain-text body
  may include only bounded operation/event types, sanitized error tokens and
  status, live/test mode, and opaque stable operation-attempt or Stripe
  request/event correlation. An SDK-to-hosted-error adapter may retain only the
  already-validated opaque Stripe request id in a frozen non-serialized cause
  record; client-visible details may expose only its presence. The adapter must
  discard the raw error, provider message, submitted parameters, and payload.
  It must not include member or customer identity, contact details, checkout contents,
  raw provider messages, raw errors, or webhook/provider payloads. Alert-send
  diagnostics may expose only the alert kind, sanitized provider status/code,
  and a safe Stripe type token. Only the Web-owned terminal billing-action
  boundary may classify an SDK or explicitly wrapped provider rejection as
  alertable; a generic application failure or a provider rejection absorbed by
  recovery, cleanup, or replay must remain silent. The public Family checkout
  redirect may report its mandatory Session-read rejection only after the
  submitted Session ID's unique blind lookup key still resolves to a current
  checkout attempt; syntax alone, an unknown ID, or a cleared/stale binding
  cannot create an operator email.
- Assistant runtime state is high-sensitivity local runtime data: directories under `vault/.runtime/operations/assistant/**` must be `0700`, files under that tree must be `0600`, secret-bearing provider headers must never remain inline in persisted session JSON, and operator-facing repair flows should use `assistant doctor --repair` to tighten assistant runtime permissions in place. Inline secret findings indicate stale local session data that should be rebuilt or repaired manually rather than a supported migration lane.
- Vault-file refs remain normalized and non-hidden except for one flat assistant-owned shape: `.runtime/operations/assistant/generated-deliveries/<filename>`. Initial preparation may accept that exact ref only after the reader-compatible runner has converged, and both initial and retry paths must adopt/revalidate its regular bounded file before revalidating filename, media type, byte size, and SHA-256. Adoption tightens assistant-runtime parents to `0700` and the exact file to `0600`; ordinary vault refs are not chmodded. Prefix siblings, nested paths, hidden filenames, control characters, snapshot-excluded temp/lock names, symlinks, special files, and every other hidden ref fail closed. Never infer ownership or deletion authority from `exports/assistant-deliveries/**` or another generic vault path.
- Do not clear or abandon provider-native assistant thread continuity merely because a tool returned authenticated private data or because provider history differs slightly from delivered output. Session invalidation is not a privacy boundary. Protect private data through authorization, bounded tool results, output and logging policy, and the normal encrypted snapshot boundary.
- Assistant runtime is also storage-boundary-sensitive data: it is execution residue, not a product-state staging area. If a datum is user-facing, queryable, or something future product features will build on, give it a canonical vault home or explicit derived materialization instead of persisting it under assistant runtime.
- Automatic generated-file deletion authority is limited to direct files under `.runtime/operations/assistant/generated-deliveries/` after assistant work is quiescent and only when the complete outbox inventory and flat owned directory are trusted. Nested directories, unsafe names, symlinks, or special entries abort deletion; an untrusted inventory retains every staged file. Never infer deletion authority from an extension, basename, broad `exports/**` match, or generic vault-file ref. Existing user files and durable or canonical data must not be moved or copied into runtime staging merely for delivery, and prepare-now/maybe-later files remain at their durable owner paths.
- Runtime observability writes under `vault/.runtime/operations/assistant/diagnostics/**`, `vault/.runtime/operations/assistant/journals/**`, quarantine metadata, and persisted delivery errors must redact inline bearer tokens, cookies, API keys, and similar secret material before the artifact is committed.
- Persisted runtime logs, CI logs, uploaded artifacts, and user/provider-facing output must never print raw PHI, health data, vault contents, model prompts, model messages, transcripts, request/response bodies, final provider requests, file text, lab reports, or similarly sensitive payloads. Local one-off diagnostics may inspect concrete payload shape or values when needed to prove root cause, but must stay out of commits, uploaded artifacts, and external surfaces, and must never expose secrets or raw credentials. The static `pnpm logs:guard` check blocks direct logging of variables named `prompt`, `messages`, `input`, `output`, `response`, `body`, `transcript`, `vault`, `finalRequest`, `fileText`, and `labReport` unless the value is passed through an explicit redaction, sanitization, or summarization helper, or reduced to counts/status for persisted or uploaded logs.
- Device-sync account metadata is internal diagnostic state only. Hosted and local storage writes must sanitize it down to a compact shallow scalar record instead of persisting provider profile payloads, nested JSON blobs, or oversized string fields.
- The resident Codex App Server is a privileged local adapter, not a sandbox boundary. Normal assistant turns should rely on the bound Murph runtime/tool surface and canonical write ownership in `packages/core`, not a second provider-workspace or canonical-write-guard safety model. The narrow exception is `executeReadOnlyAssistantAsk`: model-invoked commands in that one-shot child are confined by the native `murph-group-read` permission profile. The child reuses the trusted hosted Codex home for minimum auth/config lifecycle, but its thread request passes the named `permissions` override and never a legacy `sandbox` field; the pinned App Server must attest the effective profile, exact runtime roots, empty working directory, empty instruction sources, and approval policy in its thread-start response, and any mismatch fails closed. The profile grants read only to Codex's minimal runtime and exact group workspace roots, denies `.runtime/**`, `.codex/**`, retired vault-share projection roots, and environment files, disables tool network plus project config/instruction discovery, uses approval policy `never`, and gives shell commands an inherit-none environment with no provider credential or hosted secret. The supervising App Server may receive minimum provider auth, but the child's only dynamic tool is the consent-aware lazy `murph.group/read_shared` read. It receives no mutation or delivery tool, route grant, signing material, MCP, web search, memory, plugin, app, or multi-agent authority. A production-like Linux sandbox smoke must prove the effective profile or the feature remains disabled.
- Hosted process-only App Server initialization may begin only after workspace
  restore, final managed Codex config/auth preparation, and staging of the first
  fresh auto-reply-enabled pre-pass Linq or Telegram input candidate. Email,
  self-authored Linq, bootstrap, system, maintenance, replay, and active-turn
  imports cannot admit it. It uses the final ordinary-process launch identity
  but issues no thread start or resume, turn start, provider request, account
  operation, dynamic-tool assembly, compaction, or child launch.
  Initialization is not accepted-input, provider-egress, canonical-write, or
  delivery authority; those remain bound to the later admitted foreground turn
  and active runtime write fence.
- Speculative preparation must not replace a healthy claimable resident with
  another launch identity; only authoritative foreground acquisition may do that.
  Cancellation, auth/config mutation, and checkpoint cancellation of
  still-pending unreserved initialization must stop the exact owned process and
  reject its pending RPCs before the boundary proceeds. The runtime closes and
  joins asynchronous preparation admission before snapshot construction or
  invocation release.
  Invocation release uses the exact-process handle returned by preparation, so
  a stale invocation cannot cancel a later replacement. The existing
  engine-owned slot-transition lock spans exact teardown through replacement
  publication and the checkpoint decision. The same owner marks the full
  workspace-boundary call active, so resident preparation declines and warm
  foreground or account acquisition begun while it is active fails busy rather
  than publishing behind that boundary. A caller that already obtained a
  slot-transition ticket retains FIFO priority, so the boundary observes that
  process or fails busy rather than overtaking it. Initialization readiness and
  background-work waiting remain outside the lock. No launch key, container
  identity, late initialization response, or merely resident process may
  substitute for current turn or signed provider authority.
- Model-backed detached system-mailbox notifications without a valid scheduled occurrence must remain isolated output-only provider work. They receive no conversation history, private context, native resume, dynamic or hosted tool context, shell, browser, apps, plugins, web search, provider fetch, public fetch, artifact materializer, image-generation launcher, progress delivery, or delegated-agent surface. Treat embedded provider, callee, webhook, and Family text only as untrusted data; only the final delivery adapter may send the formatted result. Run them as fresh ephemeral threads whose restrictive thread config leaves the resident App Server launch identity unchanged and cannot persist a resumable notification thread.
- `assistant.ask.requested` and `assistant.ask.completed` may carry bounded question and answer content only in the existing encrypted mailbox and transient process state. Web derives the target runtime, exact membership generation, origin, expiry, and private return route from the signed caller; the model cannot supply them. Only the trusted target adapter may pass an authorized workspace root and committed conversation evidence to `executeReadOnlyAssistantAsk`. Web rechecks membership before target context is read and before completion is appended, and the private runtime treats the answer as untrusted data. Leaving, rejoining, expiry, an unsafe route, or a stale runtime fence suppresses completion rather than widening access. Failed Ask diagnostics may expose only a validated opaque request id, an allowlisted Prisma `P####` code when present, and HTTP status; they must never expose raw exceptions, response bodies, mailbox content, questions, answers, membership ids, runtime ids, or return routes. Diagnostic values are correlation metadata only and are never caller-supplied authority.
- Except for that explicitly confined Assistant Ask child, Codex running inside the local Murph runtime or hosted execution container is assumed to have full access to that local/container filesystem. Passing repo-relative, vault-relative, or container-local paths to Codex so it can inspect or modify files is not a privacy leak by itself. Those paths still must not escape into user-facing messaging copy, public API responses, persisted logs/diagnostics, fixtures, generated docs, screenshots, provider requests, external review bundles, or other third-party outputs unless the surface has an explicit safe path policy.
- Assistant turns may execute the same canonical local assistant/vault tool catalog shape through the active vault's per-turn Murph runtime context. Message-triggered assistant auto-reply now has the same full Murph autonomy as other assistant turns, including assistant runtime control plus canonical `memory` / `automation` and canonical vault write surfaces, so any accepted inbound channel message is effectively an operator-authorized action for that bound user and vault. The hard-cut assistant command surface is Codex App Server only: it may run with normal local CLI/filesystem/env authority through Codex-specific launch/config options, while legacy OpenAI-compatible endpoint flags are not part of the command surface. That privileged Codex App Server posture still does not grant hosted-control-plane authority outside the local runtime boundary.

## Scheduled assistant action authority

A scheduled tool action is authorized only by the trusted runtime's exact
`automationId + occurrenceAt` pair when the turn trigger is `automation-cron` and
the occurrence equals `scheduledOccurrenceAt`. Assistant Engine derives the opaque
typed occurrence scope itself; it never creates an `ain_` identifier. Model
arguments cannot choose, replay, or transform that scope. It does not grant
accepted-message targeting, participant identity, physical-mail continuation, support
escalation, subscription changes, or any other fresh-human-input capability.

Personalization transports either the existing accepted `assistantInputId` or the
additive exact scheduled pair. Web verifies the signed, member-bound runtime
callback and active hosted access in both cases; accepted-input writes retain their
mailbox and current-route causal checks, while scheduled writes never fabricate a
conversation message or participant. Scheduled authority does not bypass existing
channel or audience eligibility. An optional exact provider tool-call id is retry and
command identity only: it cannot supply, replace, or widen accepted-input or scheduled
authority. Clinical Records links remain private and use an operation-scoped retry
key. Only the exact authenticated launcher may resume through sign-in. Its one-time
claim is staged in browser history state and removed from any legacy visible fragment
without erasing unrelated state or URL context. Automatic Web-control replay is
restricted to the deterministic, non-mutating scheduled request-key branch; current
message-authorized claim creation remains single-attempt at the transport boundary.
Ordinary feedback and verified-private
support escalation both require accepted-message authority; scheduled turns receive
neither capability.
