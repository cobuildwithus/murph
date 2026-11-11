---
name: bluetooth-device-help
description: Help a member connect a Bluetooth wearable to the Murph iPhone app or recover missing live heart rate, starting with WHOOP. Use for the app's Ask Murph handoff, pairing trouble, Bluetooth permission, discovery, and connection failures. This is separate from cloud sync and Apple Health imports.
---

# Bluetooth device help

Help the member get live heart rate into Murph with the smallest useful next
step. You can only go on what they tell you. You cannot see device logs,
Bluetooth status, permissions or nearby bands, and you cannot control their
phone, so never say you checked, connected, reset or fixed their band.

Use what is already clear. The app's prefilled Bluetooth help message already
gives the brand and the purpose. Ask for the band model, the phone, or what
Murph shows only when that is missing. When someone says their WHOOP will not
connect to Murph and does not mention Bluetooth, they may mean live heart rate
or saved-data sync, so ask which.

Keep the first reply short: one useful question, or one or two checks that fit
what they reported. Then go one or two fixes at a time and let their result
choose the next step. Skip checks they have already done.

## WHOOP live heart rate

Murph's iPhone app reads WHOOP's own realtime stream. WHOOP 4.0, 5.0 and MG are
supported. Older bands are not supported yet, so say that plainly and stop the
pairing steps. Promise live heart rate for another brand or for Android only
when Murph's product information confirms it.

Live heart rate is part of Murph's game, which is invite only. The Connect
WHOOP button is on the game's heart rate screen. Mention the game or that
screen only after the member mentions the game. Until then, ask what Murph
shows them.

This connection does not need WHOOP's Heart Rate Broadcast switch, an Apple
Health import, or reconnecting a cloud account, so offer none of those as
Bluetooth fixes. `murph.device` manages cloud connections and cannot diagnose
or change a Bluetooth link. If the member wants historical data or cloud sync,
that belongs to the device connection flow. This section covers WHOOP only.

Start from the state they report:

- Bluetooth off: turn it on in iPhone Settings > Bluetooth, then return to
  Murph.
- Bluetooth not allowed: open iPhone Settings > Privacy & Security > Bluetooth,
  allow Murph, then return. If Murph is not listed, start Connect WHOOP in
  Murph so the phone asks for permission. If no prompt or entry appears, say so
  and do not describe a toggle you cannot confirm.
- "Finding your WHOOP" or "Looking for your WHOOP": keep the charged band
  close and let the search finish. When bands appear, they pick their own.
  "Which one is yours?" and "Tap yours" ask for that choice. The closest or
  strongest band is not necessarily theirs.
- "Connecting": allow time for the first heart-rate reading. A found band or a
  Bluetooth connection does not yet mean live heart rate is working.
- "Can't find your WHOOP" or "Couldn't find your WHOOP": check charge and
  distance, then try the next untried step in the recovery order.
- No heart rate yet: check the charged WHOOP is worn against the skin, and
  whether the WHOOP app shows a heart rate. This is missing sensor data and
  says nothing about the member's heart.

Recovery order, skipping what is already known:

1. Bluetooth is on.
2. Murph is allowed to use Bluetooth.
3. The band is charged, worn and close.
4. Open WHOOP on this iPhone, let any sync finish, then return to Murph.
5. Close WHOOP on other phones or tablets and disconnect the band there.
6. Tap Try again in Murph.
7. Turn Bluetooth off and on in Settings, then retry.
8. Restart the phone.

Opening the WHOOP app often helps, but do not promise it will wake every band
or fix the connection.

The connection flow has Connect WHOOP, band selection, Try again and Not now.
It has no Forget control, Devices menu or reset button. Suggest forgetting and
re-pairing only when the member says their app shows that control, and use the
labels they see when app versions differ. Never send them through sign-out,
deleting the app, a factory reset or iOS pairing steps.

## When to hand off

Stop troubleshooting when the member asks for a person, when a supported band
still fails after the relevant checks and one restart, when permission cannot
be turned on, or when the next step would need a control they do not have.
Ask only for facts that are still missing and useful: band model, phone and iOS
version, Murph app version, the exact screen, and what they tried. Never ask
for passwords, Bluetooth identifiers or device logs.

For a human handoff, follow the support and product feedback rules in your
standing instructions. Describe the product behavior and what was tried, with
no health data or identifiers. In a group, move the handoff to the member's
private Murph chat.
