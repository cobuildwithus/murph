---
name: bluetooth-device-help
description: Help a member connect a Bluetooth wearable to the Murph iPhone app or recover missing live heart rate, starting with WHOOP. Use for the app's Ask Murph handoff, pairing trouble, Bluetooth permission, discovery, and connection failures. This is separate from cloud sync and Apple Health imports.
---

# Bluetooth device help

Help the member get live heart rate into Murph with the smallest useful next
step. Work from what they tell you: you have no device logs, Bluetooth status,
permission readout, nearby-band list, or remote control of their phone. Never
claim to have checked, diagnosed, connected, reset, or fixed their band.

Reuse what is already clear. Ask which band/model and phone they have and what
Murph shows only when those facts are missing. A WHOOP-to-Murph request that
does not mention Bluetooth may mean live heart rate or saved-data sync; ask
which when unclear. The app's prefilled Bluetooth help message already tells
you the brand and purpose. Keep the first reply short, with a useful question
or one or two relevant checks. Continue one or two fixes at a time, using the
member's result to choose the next step. Do not send the whole checklist or
repeat checks they have already completed.

## WHOOP live heart rate

Murph's iPhone game reads WHOOP's own realtime stream. WHOOP 4.0, 5.0 and MG
are supported; older bands are not supported yet. Say that plainly for an older
band instead of continuing pairing steps. Do not promise another band's or
Android app's live-heart-rate support without a verified product contract.

This connection does not require WHOOP's generic Heart Rate Broadcast switch,
an Apple Health import, or a cloud account reconnect. Do not offer those as
Bluetooth fixes or call `murph.device` to diagnose or change a local link.
If the member instead wants historical data or cloud sync, use that existing
connection owner. Other bands can gain their own guidance here when supported;
do not apply WHOOP-specific behavior to them.

Start at the state they report:

- Bluetooth off: turn it on in iPhone Settings > Bluetooth, then return to Murph.
- Bluetooth not allowed: iPhone Settings > Privacy & Security > Bluetooth,
  allow Murph, then return. If Murph is absent, start Connect WHOOP in Murph
  to request permission; if no prompt or entry appears, do not invent a toggle.
- Finding your WHOOP or Looking for your WHOOP: keep the charged band close
  and let the search run for about 30 seconds. Once bands appear, choose their
  own band. “Which one is yours?” or “Tap yours” asks for that selection;
  closeness/signal strength alone does not establish ownership.
- Connecting: allow time for the first heart-rate reading. A discovered band
  or Bluetooth connection alone does not mean live heart rate is working.
- Can't find your WHOOP: check charge and proximity, then try the next
  untried recovery below. The wording may also be “Couldn't find your WHOOP.”
- No heart rate yet: check that the charged WHOOP is worn against the skin.
  Recheck whether it reports heart rate in WHOOP before escalating. This is
  missing sensor data, not a medical conclusion about the member's heart.

Choose from this recovery order, skipping what is already known: Bluetooth on;
Murph's Bluetooth permission allowed; band charged, worn and close; open WHOOP
on this iPhone, let any sync finish, then return to Murph; close WHOOP on other
phones or tablets and disconnect the band there if connected; use Try again in
Murph. If those fail, turn Bluetooth off and back on in Settings, then retry;
a phone restart is a later option. Do not promise that opening WHOOP will wake
every band or fix the connection.

Forgetting and re-pairing in Murph is a last recovery option only if that
member's app actually exposes it. The current game connection flow has Connect
WHOOP, band selection, Try again and Not now; it has no member-facing Forget
control. Do not invent a Devices menu, reset button, or re-pair path. If no
such control is visible, stop and hand off rather than sending them through
sign-out, app deletion, factory reset, or an unrelated iOS pairing procedure.
Use the member's actual labels when app versions differ.

## When to hand off

Stop when the member wants human help, a supported band still fails after the
relevant checks and one restart/retry, permission cannot be enabled, or the
next step would require a missing control. Ask only for useful missing facts:
band model, phone/iOS and Murph app version, exact on-screen state, and checks
already tried. Never request credentials, Bluetooth identifiers or device logs.

Use the existing Support and Product feedback contract for a human handoff in
a verified private conversation. Keep the summary about product behavior and
untried/failed recovery, without health data or identifiers. In a group, move
the support handoff to their private Murph chat. Follow the tool result: a
recorded escalation is not a delivered email, opened ticket, promised response,
or fixed connection. If support submission is unavailable, say so; give
support@withmurph.ai when they ask how to contact support. Do not keep cycling
through the same fixes.
