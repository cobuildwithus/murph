# Start admitted direct-message typing during ingress

Status: active

Outcome: Show typing while an admitted direct message waits for runtime callbacks.
Reaches: Existing direct Linq conversations; signup and runtime reply ownership stay unchanged.
Proof: Exercise provider acceptance, nonblocking wake, denial, replay, cancellation,
and failed typing with synthetic inputs; run Web typecheck and focused tests.

## Evidence and design

Read-only incident timing separates prompt runtime wake from slow callback startup
and provider-authority acquisition. Provider typing itself can be fast while its
preceding callbacks consume the silence budget. The existing Web signup hint and
ingress acceptance timestamp provide the appropriate owner and telemetry seam.

Start a bounded, best-effort hint after a fresh direct mailbox append. Verify the
exact inbound chat, current member access, consent, and read-only usage allowance.
Do not await admission or provider I/O on the wake path. Failed handoff cancels a
pending start and clears an issued hint. Replays, group messages, self echoes,
Web-owned first turns, denied access, and late admission keep their current path.
Runtime authority, model admission, actual replies, and alert thresholds remain
with their existing owners. No schema, new scheduler, or protocol change.

## Remaining work

- Scoped commit and applicable PR/review gates.
- Production timing after managed Web deployment remains operational proof.

## Verification and parent review

- 284 focused Web tests passed across ingress typing, webhook dispatch, wake
  and trace persistence, and the changelog archive. Direct-message dispatch
  completes with the provider typing response held pending. Signup continuations
  retain their existing hint and reply ownership.
- Web typecheck, complexity guard, whitespace, and documentation drift pass.
  Existing webhook complexity does not increase; the new helper is at the
  threshold with no added complexity debt.
- Reviewed synthetic denied/inactive/suspended/withdrawn, wrong-chat, duplicate,
  group, reaction, cancellation, slow admission, provider rejection, and handoff
  failure paths. Product walkthrough: Ready for the bounded hint contract.
- No prompts, initial provider inputs, schemas, alerts, runtime fences, or reply
  delivery behavior change. The hint reuses the canonical read-only usage gate
  and existing provider methods; one member is considered and no transaction is
  held over provider I/O. The provider request has a 2.5-second timeout; admission
  completing after one second is ignored. No retries or refresh loop are added.
- Read-only database and hosting-provider evidence confirmed both delayed
  conversations eventually delivered replies. Production timing and handset
  presentation after deployment are not claimed by local tests.
