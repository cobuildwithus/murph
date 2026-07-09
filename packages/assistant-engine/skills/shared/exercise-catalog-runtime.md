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
2. For movements the user is likely seeing for the first time, choose the
   smallest useful set: normally two to four and rarely more than five. Lead
   with the purpose, one or two cues per movement, and only the stop rule needed
   now. Ask whether the user wants a walkthrough instead of dumping every step.
3. When the delivery surface supports response media, attach returned
   `images[]` with catalog URL, alt text, and source
   `exercise_catalog:<id>:<step>`. Do not paste image URLs into message text
   when media delivery exists. If an important movement has no image, say "no
   catalog image yet"; never imply that an image was attached.
4. If acute pain or safety requires an immediate action, give the minimal plan
   now and include available catalog media in the same response. For a known
   routine the user has already performed, send a concise reference. Provide
   full steps only when asked, accepted as a walkthrough, or required for
   safety.

Do not assign reporting homework. When subjective response matters, schedule or
offer an appropriate check-in instead.
