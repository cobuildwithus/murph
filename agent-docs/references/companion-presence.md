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
they carry no authority to read health data. Account deletion removes the
member contact timestamps, client info, and push route.

## Client build diagnostics

Native requests may send these headers; values are trimmed and otherwise kept
unchanged. Platform, version, and build must all be valid to accept client info.
Missing or invalid telemetry never changes request admission or the response.

| Header (`X-Murph-Client-` prefix) | Accepted value |
| --- | --- |
| `Platform` | Exactly `ios` or `android` |
| `Version` | `^\d{1,4}(\.\d{1,4}){0,3}(-[A-Za-z0-9.]{1,24})?$` |
| `Build` | `^\d{1,10}$` |
| `OS-Version` | `^\d{1,4}(\.\d{1,4}){0,3}$` |
| `Device-Model` | `^[A-Za-z0-9 ,._()+-]{1,64}$` |

The heartbeat's existing member update writes nullable `companionAppPlatform`,
`companionAppVersion`, `companionAppBuild`, `companionOsVersion`, and
`companionDeviceModel` (snake_case database columns). Optional OS/model values
are independently null when absent or invalid. Without valid core fields, all
five stored values remain untouched. `companionLastContactAt` remains the receipt
time; a later legacy heartbeat can advance it without refreshing client info.
These fields describe the last reporting client, not every installed device.

The shared JSON error wrapper uses the same parser to attach `clientPlatform`,
`clientVersion`, `clientBuild`, `clientOsVersion`, and `clientDeviceModel` to
error logs when client info is valid, without adding member identity or writes.
Client assertions are diagnostics, never authentication or authorization facts.
Like contact timestamps, the fields are member-row metadata, omitted from the
vault-only Settings export and removed with account deletion.

Apply `20261116010000_companion_client_info` before deploying Web. Older Web
and clients tolerate the nullable additions; no client rollout coordination or
backfill is required. Leave the additive columns in place when reverting Web.

To check which build a member last reported, use the primary read-only database
helper with an operator-bound `member_id` psql variable (timestamps use UTC):

```sql
SELECT companion_app_platform, companion_app_version, companion_app_build, companion_os_version, companion_device_model, to_char(companion_last_contact_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_contact_at FROM hosted_member WHERE id = :'member_id' LIMIT 1;
```
