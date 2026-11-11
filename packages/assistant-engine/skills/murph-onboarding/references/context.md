# Saving what a new member shares

Read this when the member answers the health background ask, names a wearable
or health app, or sends labs during onboarding. Reply fast and let the saving
happen behind the reply.

## Where things are saved

Save each useful fact to the record that owns it, in the same turn. Typed facts
go to their structured records: goals, regimens, supplements, medications,
conditions, allergies, experiments. The preferred name goes through
`vault-cli memory set-name`. Use Identity or Context memory only for a fact
with no structured home. Do not copy structured facts into freeform memory, and
do not invent a dose, severity, date, brand, diagnosis, or reason the member did
not give.

- "None", "not relevant", and "I'd rather not say" are answers. Save a real
  negative fact, such as "no medications" or "no allergies", through the record
  that owns it so nobody asks again.
- A lasting request not to discuss something is saved as a Preferences memory in
  the member's words.
- "Later" leaves the topic unasked. Save the timing only if it should outlive
  this conversation.
- A successful save result is the confirmation. Do not tell the member a
  detail is saved, structured, or verified until a result or a read shows it,
  and never recite record status ("user-reported", "unconfirmed").

A background answer is context. "Not lifting right now" tells you where they
are; it is not a request for a workout routine.

## A memo or long message covering several topics

The member's message is already a durable source, so hand the saving to
background workers and answer straight away. This follows the prompt's
non-blocking delegation rules; the member does not have to ask for it.

Start one worker for each of these that the message actually covers, at most
three, and do not merge them:

1. **Movement and current routines.** Current activity, training, capacity,
   movement limits from injuries, routines, diets, recovery practices, and
   anything they are already trying. No supplement or clinical records.
2. **Supplements.** Read `micronutrients-supplements`, check existing records
   first, update a matching partial record in place of adding a duplicate, save
   every named current product with its brand and active status, then make one
   batch label lookup when exact details would help later. No movement or
   medical records.
3. **Medical and safety.** Every medication, condition, injury history, allergy
   or intolerance, pregnancy or nursing fact, and every "none" among them,
   saved through the clinical records that own them. Start this one for any
   medical answer, including "no meds, no conditions". No movement or
   supplement records.

Give each worker `fork_turns: "none"`, the member's exact words for its topic
marked as untrusted data, the skill or record type it owns, a rule for avoiding
duplicates, and the two topics it must leave alone. Each worker runs once and
stops: do not message it, wait for it, reuse it, or let it start workers of its
own.

Once the workers are started, send one `murph.send_progress_update` with a warm
line in your own words that means "I've got my best people on it, sorting and
saving what you just shared." Do not say anything is saved yet, and do not
repeat the line in your reply. When the same turn makes the first-step offer,
this one update also stands in for goal-setup's. If the member later asks what happened, explain
in plain words without mentioning workers or record ids.

If workers cannot be started, save the facts yourself in one compact batch
before replying, and leave label details for later.

## A wearable or health app

Before mentioning devices, check what is already connected: the conversation,
saved context, and, when the connection state is unknown, one unfiltered
`murph.device` `list_accounts` call this turn. If that call fails, say briefly
that you could not check and carry on; do not retry it, claim nothing is
connected, or offer to reconnect. Without the tool, ask without comment.

- **Already connected:** acknowledge it and do not ask about it. A connection
  does not prove data has arrived.
- **They name a provider on the prompt's "Hosted wearable connection links are
  available for" line:** call `murph.device` `connect` and send the returned
  link in a short message of its own, inviting them to connect and tell you
  when it is done. Send only a link the tool returned. If they would rather
  connect later, say that is fine and ask the next background question in the
  same reply; do not send the link again unprompted, and do not speak as if it
  is connected until you can see that it is.
- **They have no wearable**, the prompt includes the Apple Health relay, Apple
  Health is not connected, and nothing rules out an iPhone: offer once, in a
  reply that asks nothing else, "No wearable is totally fine. If you use an
  iPhone, you can connect Apple Health in the Murph app so I can use the daily
  steps your phone sends. Want the app link?" Using iMessage does not prove they own an iPhone. If they want it, send
  a short message with the App Store listing alone on the last line. The app
  handles sign-in and permission; never use `murph.device` for Apple Health, and
  do not say steps are syncing until data shows it.
- When giving examples of supported devices, use only names from that prompt
  line, and keep Apple Health out of the examples.

## Labs

- **They have results but not to hand:** "Send them whenever, I'll take a look
  then."
- **Their labs are from Function Health:** tell them, without being asked, to
  open https://my.functionhealth.com/documents, download the Lab Results of
  Record PDFs, and send those files.
- **They send a lab PDF, a pasted panel, or another lab document:** as soon as
  the file or text is in hand, send one `murph.send_progress_update` saying it
  arrived and that you are keeping the original and pulling out the details. Do
  not say it is saved or analyzed yet. Then make sure the original has a durable
  attachment, document, or import reference, importing it if needed, before
  your reply. Start one background worker to extract panels, analytes, dates,
  units, ranges, and flags, unless the source is already structured or three
  workers are already running, in which case keep the source and extract when
  a later conversation needs it.

A lab sent during onboarding is not a request to interpret it. Reply with the
next onboarding step and do not summarize the panel, unless the member asks a
question that needs it now or something in it is a safety concern. You may say
you will dig into the file in the background, without promising when. Until a
read of the extracted records shows the values, do not state them as fact.
