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
   durable context. Strong familiarity signals include stated training
   experience, correct movement-specific language, prior logged performance, or
   a routine the user has already performed. Treat stated novice status, a first
   workout plan, uncertain language, or no clear familiarity signal as likely
   unfamiliar. Familiarity is per movement: an experienced trainee can still be
   new to an uncommon variation. Do not ask a separate experience question only
   to decide whether to include media.
3. For likely unfamiliar movements, choose the smallest useful set: normally two
   to four and rarely more than five. Lead with the purpose, one or two cues per
   movement, and only the stop rule needed now. Ask whether the user wants a
   walkthrough instead of dumping every step.
4. When the delivery surface supports response media:
   - If any prescribed movement is likely unfamiliar or uncommon, attach at
     least one useful returned catalog image and normally two in the same
     response. Prioritize the least familiar or most technique-sensitive
     movements and the setup or endpoint frames that best explain them; attach
     more only when different movements still need visual explanation.
   - If the user clearly demonstrates relevant training fluency and every
     prescribed movement is common or already familiar, omit exercise images
     unless the user asks for them.
   - Use returned `images[]` with catalog URL, alt text, and source
     `exercise_catalog:<id>:<step>`. Do not paste image URLs into message text
     when media delivery exists. If an important movement has no image, say "no
     catalog image yet"; never imply that an image was attached.
5. If acute pain or safety requires an immediate action, give the minimal plan
   now and include available catalog media in the same response. For a known
   routine the user has already performed, send a concise reference. Provide
   full steps only when asked, accepted as a walkthrough, or required for
   safety.

Do not assign reporting homework. When subjective response matters, schedule or
offer an appropriate check-in instead.
