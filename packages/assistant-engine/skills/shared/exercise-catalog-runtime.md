# Exercise catalog lookup and presentation

Use this reference after the domain skill has decided which movement type, dose,
and safety boundaries fit. This reference owns catalog lookup and first-show
presentation; it does not decide whether an exercise is clinically or
programmatically appropriate.

1. Search with the smallest useful `vault-cli exercise list ... --format json`
   query. For each final movement, run `vault-cli exercise show <id-or-slug>
   --format json` so instructions reflect the reviewed steps, equipment, level,
   targets, images, and source-backed safety notes. Never invent an id. If no
   useful match exists, say so and use only a simple conservative description.
2. Decide likely familiarity per movement from the current conversation and
   durable context. Strong familiarity signals include stated experience in the
   relevant training modality, correct movement-specific language, prior logged
   performance, or a routine the user has already performed. Let explicit
   modality experience cover common movements in that modality even when the
   user has not named them or used technical language; regular calisthenics, for
   example, is a familiarity signal for ordinary push-up and pull-up variations.
   Treat stated novice status, expressed uncertainty about the movement, or no
   relevant experience signal as likely unfamiliar. A first plan with Murph is
   not itself novice evidence. Familiarity is still per movement: an experienced
   trainee can be new to an uncommon variation. Do not ask a separate experience
   question only to decide whether to include media.
3. For likely unfamiliar movements, choose the smallest useful set: normally two
   to four and rarely more than five. Lead with the purpose, one or two cues per
   movement, and only the stop rule needed now. Ask whether the user wants a
   walkthrough instead of dumping every step.
4. Exercise media belongs only in a response that is actually teaching or cueing
   a movement: a requested walkthrough, a form or explanation answer,
   just-in-time session instruction, or an immediate safety action. A setup-only
   activation turn, plan or save confirmation, reminder or review scheduling,
   and the first-launch close are not movement-instruction turns merely because
   the saved plan contains named exercises. Defer catalog media until the first
   instructional turn or until the user asks to see the exercises.
5. For every routine, keep each dose and instruction concrete. Estimate the
   exercise time, transition time, and total honestly. Before sending, compare
   the stated total with the work in the routine and do not pad a short plan to
   sound more substantial. On Telegram, prefer a Rich Message when its structure
   makes the routine easier to read or use. The
   `murph.attach_exercise_routine_card` tool is useful when its standard layout
   or catalog images fit. The `murph.attach_telegram_rich_content` tool is also
   valid when a custom or mixed layout is clearer. These tools are presentation
   options, not exclusive content owners. A card must carry the complete answer,
   so do not repeat it in final text or combine it with response media. Styled
   Telegram text is not a Rich Message.
6. Exercise images are optional, but use them when available and helpful,
   especially for unfamiliar or technique-sensitive movements. Choose the
   smallest useful set and keep the complete response at eight images or fewer.
   For a card, copy each selected catalog image URL, alt, and step exactly.
   Construct its source as
   `exercise_catalog:<returned-item-id>:<1-based-position-in-images[]>` and keep
   the returned order. For Linq/iMessage, use the existing response-media path
   when images improve the instruction. On Telegram, follow the routine-card
   tool's per-movement mapping and bounded validation-repair guidance. Keep
   catalog images inside that card and never use separate response media as its
   fallback. If the card still cannot attach, use one complete generic Rich
   Message without images and name every movement separately. Do not paste image
   URLs into message text when media delivery exists. If an important movement
   has no useful image, keep the written cue clear and never imply that an image
   was attached.
7. If acute pain or safety requires an immediate action, give the minimal plan
   now. For a known routine the user has already performed, send a concise
   reference. Provide full steps only when asked, accepted as a walkthrough, or
   required for safety.

Do not assign reporting homework. When subjective response matters, schedule or
offer an appropriate check-in instead.
