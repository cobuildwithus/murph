# Hosted usage referrals

## Status

Active implementation contract for conversational usage rewards. Web owns the
durable referral, qualification, and credit facts. Linq and Telegram normalize
their ingress into the same provider-neutral state machine. A future provider
must call that same boundary; it does not justify speculative channel code.

## Product behavior

When trusted usage context says a personal or group Murph is running low, Murph
may offer the exact current sender an earned-continuity mission. Describing a
mission is not consent. Murph arms one only after that person explicitly chooses
one exact server-returned policy.

| Policy | Qualification | Reward |
| --- | --- | --- |
| `new_person_activation_v1` | The referrer starts a fresh Murph group with a genuinely new person. That person activates their own Murph after the mission was armed and then speaks in the bound target group. | $2 credit; presented as about 50 current Sol messages or 100 current Terra messages |
| `active_group_v1` | The referrer starts a fresh Murph group that reaches 15 qualifying human messages, including at least 8 messages from at least 2 non-referrer speakers, across at least 10 minutes. | $3.50 credit; presented as about 70 current Sol messages or 140 current Terra messages |

The source conversation determines the reward destination and where completion
is celebrated:

- a mission armed in a personal conversation rewards that personal member;
- a mission armed in a group rewards that source group;
- each group participant may independently arm and earn a mission for the same
  room;
- the fixed ledger reward remains usage value, while the tool recomputes an
  approximate message-capacity label from the destination's current effective
  model both when read and when completion is celebrated;
- a model without a catalog estimate receives a generic bonus-usage label;
- trial rewards add usage capacity but never extend the trial end date.

Completion is celebrated in that same source conversation. A personal mission
freezes the runtime-injected source channel, blinded exact-thread locator, and
directness fact; queueing later resolves that channel from current member
routing and requires the same direct thread. A group
mission uses its synthetic source-container route and live external-thread
authority. Celebration copy never carries a detached profile name, so a
durable mailbox item cannot outlive name-sharing permission or account
deletion. A queued personal Linq celebration uses the existing explicit-target
delivery shape for that resolved source. Provider entry rechecks the fixed
target and records terminal delivery failure if authority moved or was revoked;
it never replaces the source with a newer home conversation.
The isolated celebration receives only a server-resolved tone, Humor, and
Unhinged band. It receives no raw transcript or room history and therefore
cannot claim a callback; it keeps any edge aimed at Murph rather than an absent
person.

The referrer's latest unbound mission supersedes their older unbound mission.
An already-bound target continues qualifying. Earned rewards are final.

The new-person mission deliberately reuses normal Murph onboarding instead of
creating a referral-specific claim or activation system. After arming, Murph
tells the referrer to start the fresh group and ask whether the other person
wants their own personal Murph. Only after that person accepts should Murph
share the recognizable first-party website handoff. The person completes the
ordinary activation flow with the same provider identity observed in the
target, returns to the group, and says hi. The combination of post-arm
activation and target presence provides attribution; the browser never chooses
the referrer, destination, target, policy, or reward.

## State and attribution

`HostedUsageReferral` is the one durable state owner:

```text
armed -> target_bound -> rewarded
   \         \-------> expired | disqualified
    \---------------> superseded | canceled | expired
```

Arming freezes the referrer, beneficiary, policy code and version, reward,
seven-day window, and—only for a personal destination—the blinded source
conversation. The referrer's next newly created thread container binds only
when its durable owner is that exact referrer and creation happened after
arming. Existing rooms cannot bind. For Linq, a compatibility first-message
fallback may provision a provisional route but cannot bind a referral. The
signed managed-line `participant.added` actor invokes the event-time,
idempotent binder after the authoritative route ensure. It can therefore bind
only the final owner's mission that was already armed when Murph was added,
including when the provisional first-speaker owner was already correct.

The hosted runtime injects current Linq or Telegram sender handles from accepted
input context. The model cannot provide identity, beneficiary, route, target,
amount, counters, or provider authority. Personal direct calls resolve to the
authenticated runtime member. Group calls fail closed unless exactly one
provider-scoped current sender resolves to an active personal member.

No hidden watermark is created by low-usage copy. `read_usage_referral` reads
availability; `arm_usage_referral` and `cancel_usage_referral` require fresh
user-sourced input. Cancellation applies only while the mission is unbound.

## Portable ingress evidence

Provider adapters pass only:

- target container member id;
- a provider-domain-separated message lookup key;
- occurrence time;
- resolved sender member id when one is already authorized;
- a provider-domain-separated sender subject key.

Raw phone numbers, email addresses, Telegram ids, message ids, and chat ids do
not enter the referral row. A personal source stores only runtime-produced
`hid_` conversation locators. Event and non-referrer speaker keys are bounded,
deduplicated arrays and are cleared at terminal state.

One admitted inbound human provider message counts once. Murph output,
reactions, empty unsupported events, and duplicate provider events do not
count. The portable active-group rule deliberately measures observed
participation rather than a provider roster: Telegram does not expose the same
authoritative full-room roster as Linq.

Provider occurrence time, not delivery order, decides admission inside a
bounded delivery policy. Evidence at or after expiry is ignored. A bound row
and its cap commitment remain eligible for delayed pre-expiry evidence through
25 hours after that occurrence window closes. The first referrer-serialized
expiry boundary after that grace terminally clears an unqualified row; evidence
delivered later is outside policy. This single derived cutoff covers Linq's
documented roughly 25-minute automatic webhook retry window and Telegram's
documented maximum 24-hour pending-update retention with one hour of processing
margin. Neither provider exposes a durable producer watermark, so the feature
does not claim unlimited late admission or create another finality owner.

An unlinked Telegram participant in an already-bound group may contribute only
bounded referral evidence. Their message remains excluded from the assistant
mailbox, grants no assistant access, and produces no setup reply in that group.
An unlinked direct message keeps the ordinary Telegram setup path. The
new-person policy still requires normal member activation plus a later linked
target-group message.

## Credit accounting

`HostedUsageCreditEntry` remains the immutable accounting owner. Each
`purchase_grant` or `referral_grant` entry freezes its source and provenance;
the one-to-one `HostedUsageCreditGrant` row stores only that entry's mutable
remaining-capacity projection.

- Purchase fulfillment creates a `purchase_grant` entry plus its projection.
- Referral completion creates a `referral_grant` entry plus its projection.
- Usage settlement consumes projected grant capacity FIFO by immutable entry.
- The historical purchase remaining field is updated alongside the generic
  projection during the expand/contract migration.
- Refund and dispute reconciliation can touch only purchase-backed entries.
- Referral-backed entries have no financial reversal or clawback path.

The beneficiary member row remains the single serialization boundary for
positive grants, debits, adjustments, the bounded balance/version projection,
current-period unblock reconciliation, and referral-cap commitments. Arming
locks the frozen beneficiary, plus the old beneficiary when replacing an
unbound mission in another conversation, in stable member-id order. It admits
the mission only when recent rewards, nonexpired armed commitments, and bound
commitments still inside their late-evidence grace fit both caps. Referral
observation never acquires that lock. It records evidence and `qualifiedAt`
atomically in the ingress transaction.
Once that pre-expiry qualification fence commits, later wall-clock expiry or
newly armed commitments cannot disqualify it. Post-commit reconciliation locks
the referrer and beneficiary, revalidates the frozen evidence, and issues
credit.

Grant identity is:

```text
hosted-usage-credit:referral:<referral-id>:grant:v1
```

Reward completion is replay-safe. The source celebration is a derived mailbox
notification appended after the reward commits. Its mailbox append and
`celebrationQueuedAt` fence commit in one transaction. The webhook path attempts
that append immediately; a Vercel-authenticated minute cron retries at most 50
oldest qualified or uncelebrated referrals and re-signals at most 50 oldest
unconsumed referral-celebration mailbox items per pass. A missing destination
rotates to the back by updating the existing referral timestamp. A failed
best-effort signal leaves the exact mailbox item eligible for the next bounded
pass rather than creating another queue or notification.
Missing route authority or notification failure cannot delay, reverse, or
duplicate the reward. Group notifications carry the same external-thread
authority as their route. Personal notifications fail closed when the frozen
source channel is no longer routed to the same blinded conversation. Linq
personal notifications encode the resolved source as an explicit target so
generic current-home fallback cannot move delivery after queueing. The source
locator is cleared once the celebration is durably queued; later authority loss
records ordinary terminal outbox failure without moving or revoking the reward.

Provider timing references:

- [Linq webhook delivery guarantees](https://docs.linqapp.com/guides/webhooks/)
- [Telegram incoming-update retention](https://core.telegram.org/bots/api#making-requests-when-getting-updates)

## Abuse bounds

- One unbound armed mission per referrer.
- At most three bound nonterminal missions per referrer.
- At most $10.50 in rolling-30-day rewards plus outstanding commitments per
  referrer.
- At most $20 in rolling-30-day rewards plus outstanding commitments per
  beneficiary.
- One target container binds once.
- One introduced member can produce one rewarded acquisition referral.
- The referrer cannot qualify their own activation mission.
- Every policy and amount comes from the versioned server catalog.

These are server admission rules, not assistant-visible qualification counters.

## Privacy and deletion

Unrewarded referral state is deleted when the referrer, beneficiary,
introduced member, or target container is deleted. Credit entries and their
remaining-capacity projections are deleted when their beneficiary is deleted.

If a referrer or introduced person deletes their account after a surviving
group already earned the reward, deletion must not claw back that room's
credit. The rewarded accounting receipt remains only while its beneficiary
remains and is anonymized by clearing referrer, introduced-member,
target-container, subject-key, source-conversation, and observation evidence.
This minimal receipt preserves grant provenance without retaining cross-account
identity.

## Deployment

Referral production is fail-closed unless Web reads the exact value
`HOSTED_USAGE_REFERRALS_ENABLED=1`. The rollout order is:

1. Keep that gate unset or disabled while the expand-only Prisma migration adds
   the referral schema and entry-keyed grant projection, backfills existing
   purchase grants, and deploys the compatible Web reader/writer.
2. Apply normal migration
   `20260728030000_hosted_usage_referral_credit_entry_constraints` while the
   gate remains disabled. It replaces the old purchase-only ledger checks with
   purchase-or-referral checks under a bounded metadata lock, then validates
   every existing row outside that lock.
3. Prove the compatible Web deployment is current, wait for the previous
   Vercel function window to drain, and run the DML-only contract migration
   `20260728031000_resynchronize_hosted_usage_credit_purchase_grants`. It
   resynchronizes any purchase projection written during the expand window
   without changing table constraints. It takes affected beneficiary locks in
   the same deterministic order as live grant/debit/adjustment writers before
   reading purchase capacity, and rolls back unless purchase/grant projections
   converge.
4. Enable `HOSTED_USAGE_REFERRALS_ENABLED=1`, redeploy that same or newer Web
   head, then deploy Cloudflare/hosted runtime and assistant packages. Older
   runtimes never emit the new actions.
5. Before broad exposure, prove purchase projection parity and smoke one
   personal and one group `read_usage_referral` request, one fresh-group bind,
   one replayed reward, one recovery-cron retry, the source celebration, and
   the next usage debit.

Before the first durable referral grant, rollback by disabling the gate while
keeping the compatible Web consumer deployed; runtime code may then roll back
independently. The first referral grant establishes a Web rollback floor:
older settlement or deletion code that ignores referral-backed entries must
not be restored while any referral credit remains. Forward-fix or keep this Web
head or newer. Disabling the gate prevents new arming, binding, and observation
but does not claw back earned credit or suppress reconciliation already queued
by a qualifying observation.
