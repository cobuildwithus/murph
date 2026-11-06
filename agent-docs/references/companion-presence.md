# Companion app presence

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

Consented group diagnostics share only the last-contact timestamp when the
requested data scope grants access. See the
[group diagnostics spec](../product-specs/group-challenge-data-diagnostics.md).

Companion push routes remain the Apple transport address for game notifications;
they carry no authority to read health data. Account deletion removes both the
member contact timestamps and push route.
