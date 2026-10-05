# Companion wrist reminders

`murph.device` action `haptic` accepts `wearable` (`whoop` or `garmin`) and
`operation` (`status`, `buzz`, or `stop`). Existing canonical automations own
delays of a minute or longer: a ten-minute meditation creates an ordinary
one-shot automation, whose due invocation calls the immediate command. A
requested wait under one minute, below the scheduler's resolution, is an
in-turn shell sleep before the immediate command. No new scheduler or watch
alarms.

## Ownership and authority

The assistant engine supplies a private accepted-input or automation-occurrence
origin. Model arguments cannot choose a member, connection session, command key,
delay, or arbitrary wire command. The runtime forwards through the existing
device port and signed Web callback transport to
`POST /api/internal/companion/wearables`. The service rechecks runtime ownership,
active personal-member access, and historical launch consent in the mutation
transaction. Accepted inputs must resolve to a private conversation; scheduled
origins are derived by the trusted runtime, as for existing scheduled tools.
Group/thread containers are rejected. Commands never read health-data accounts.

The native app uses bearer admission on `POST /api/companion/wearables` with
closed `connect`, `poll`, `receipt`, and `disconnect` requests. Only authenticated
members operate their own sessions. Native Bluetooth selection, vendor framing,
and physical effect execution remain in the companion repository. Deploy the
Web migration/routes before the Worker tool and companion consumer.

## Delivery and results

One session per member/vendor has a random UUID and a 20-second heartbeat lease.
An active phone cannot be displaced by another phone. The native app polls every
two seconds only while open with a ready band, and never uploads Bluetooth IDs,
device names, reminder text, or health values. Inactivity or reconnection creates
a new session, so queued commands cannot leak to a later connection.

Commands expire after 15 seconds. Their keys derive from member, input or
scheduled occurrence, vendor and operation. The ledger records unavailable
attempts too: repeating an ambiguous request cannot create a delayed buzz.
One pending buzz and one stop are permitted per session. Stop cancels only an
unclaimed buzz. Polling commits a claim before returning at most two commands;
a lost response drops the effect rather than retrying it. Receipts require the
same member, vendor, session and claimed command. Acknowledged means the band
accepted the protocol request; it does not prove motor movement or sensation.
Queued/claimed outcomes are never represented as completed vibrations.

The tables hold no command payload or reminder content. Terminal command keys
remain as duplicate-effect receipts; both tables cascade on member deletion.
All collection reads are bounded to two indexed rows. Member locking serializes
admission and claims across phone polls and runtime requests. Transactions have
five-second lock/operation limits, and contain no external I/O. Each tool request
adds one signed callback; it does not wait or repeatedly poll for a receipt.
Repeating the same request in the same turn resolves to the stored command and
returns its current status without a second buzz. When the member is testing
or troubleshooting delivery, the assistant may repeat it once after a short wait
to report a receipt; scheduled reminders make one call.
Normal conversation turns that do not call this tool add no database requests.

## App contact and unavailable reasons

The companion presence owner stores server receipt timestamps for last contact
and last foreground contact on HostedMember. POST /api/companion/heartbeat
accepts only foreground/background state under bearer member, active access and
historical consent. The native task sends every 15 seconds while execution is
available, with a three-second network idle timeout and no disk queue. It continues
opportunistically in the background; it does not keep iOS awake or prove that a
suspended app was quit. Member or consent loss cancels the task. Timestamps
survive process restarts and disappear with account deletion.

The private read-only `murph.device` action `companion_status` reports lastContactAt,
lastForegroundAt, and 45-second recent-contact freshness. Unknown includes legacy
apps with no observation. Read this alongside list_accounts and existing sync
diagnostics: contact proves neither Health authorization nor successful ingestion.
No conversation-start query or unsolicited message is added.

A modern host sends includeAvailability=true with wrist requests. Only those
callers receive unavailableReason: app_unreachable when no recent foreground
contact exists or the latest contact was background, device_disconnected when
the latest contact is recent foreground activity but the band session is absent, and busy when another command occupies the session.
Each unavailable command stores its original reason, preserving retry truth.
Legacy callers receive exactly the original strict response shape. Lease and
presence freshness are observations with bounded lag, not process-state proof.

Deploy the additive migration and Web consumers before native heartbeat senders
and the new hosted runtime. Older apps remain usable for wrist delivery through
their existing leases; no heartbeat is required to admit a ready band. Older
runtime requests omit both new capability flags, so new Web never sends them
unknown response fields. After producer deployment, rollback requires a Web
version accepting the new request flags and endpoints; a forward fix preserves
this compatibility floor.

## Test-to-message handoff

The companion uses one Test buzz action. After a correlated protocol receipt it
can open an in-app Messages composer for the member to review and send. The
existing bearer-authenticated initial-onboarding GET and POST projections retain
an optional contactAction after completion, with only href, kind, and label.
The route comes from that member's assigned contact context; a failed optional
contact read returns null without blocking onboarding. The native app retains
it only in the current session and requires a text route for this composer.

An explicit test-and-usefulness request authorizes one immediate buzz. The
assistant reads existing reminders and suggests a relevant use; that suggestion
does not authorize creating or changing a reminder. Queued delivery remains
pending, and the app must stay open for runtime command polling.

## Current limits

Delivery requires the companion app to stay open at the deadline. There is no
push wake-up or background-delivery promise. The native adapters cover WHOOP 4 and 5/MG framing and Garmin GFDI V0/V1/V2
FindMyWatch. Older-profile coverage is source- and fixture-based; it does not
establish compatibility with every device or firmware. Garmin may also sound. Hardware effects are
not part of this task's tests; the connected WHOOP must not be vibrated.
