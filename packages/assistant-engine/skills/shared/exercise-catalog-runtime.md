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
5. In a private direct movement-instruction turn, prefer one
   `murph.attach_exercise_routine_card` when the card
   alone fully answers the request. Copy catalog image URL, alt, step, and
   `exercise_catalog:<id>:<step>` source into the matching exercise. Set an
   honest time for every exercise and transition; `totalSeconds` must equal
   their sum. Use short concrete instructions, normally one or two cues per
   exercise. The runtime keeps the routine as one rich Telegram message and a
   deterministic text fallback. Do not also attach response media or repeat the
   card in final text.
6. When a routine card is unavailable or ordinary text is required, and the
   current turn is a movement-instruction turn and the delivery surface supports
   response media:
   - If any movement being taught is likely unfamiliar or uncommon, attach at
     least one useful returned catalog image and normally two in the same
     response. Prioritize the least familiar or most technique-sensitive
     movements and the setup or endpoint frames that best explain them; attach
     more only when different movements still need visual explanation.
   - If the user clearly demonstrates relevant training fluency and every
     movement being taught is common or already familiar, omit exercise images
     unless the user asks for them.
   - Use returned `images[]` with catalog URL, alt text, and source
     `exercise_catalog:<id>:<step>`. Do not paste image URLs into message text
     when media delivery exists. If an important movement has no image, say "no
     catalog image yet"; never imply that an image was attached.
7. If acute pain or safety requires an immediate action, give the minimal plan
   now and include available catalog media in the same response. For a known
   routine the user has already performed, send a concise reference. Provide
   full steps only when asked, accepted as a walkthrough, or required for
   safety.

Do not assign reporting homework. When subjective response matters, schedule or
offer an appropriate check-in instead.
