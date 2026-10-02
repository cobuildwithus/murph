# Companion wrist reminders

`murph.device` action `haptic` accepts `wearable` (`whoop` or `garmin`) and
`operation` (`status`, `buzz`, or `stop`). Existing canonical automations own
delays: a ten-minute meditation creates an ordinary one-shot automation, whose
due invocation calls the immediate command. No new scheduler or watch alarms.

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
Normal conversation turns that do not call this tool add no database requests.

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
