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
   sound more substantial. When `murph.attach_exercise_routine_card` is
   available, use one card when it alone fully answers the request. Do not
   replace that card with one or more long plain-text messages. Copy
   the same card-owned presentation when the member asks to repeat, resend, or
   improve the layout of a routine already present in the conversation. Styled
   Telegram text is not a Rich Message and does not satisfy that request. Copy
   at least one useful returned catalog image for every exercise that has one by
   default. Add more frames for unfamiliar or technique-sensitive movements,
   while keeping the whole card at eight images or fewer. Omit exercise images
   only when the user explicitly asks for a routine without them. Copy each
   selected catalog image URL, alt, and step exactly. Construct its source as
   `exercise_catalog:<returned-item-id>:<1-based-position-in-images[]>`. Keep
   the returned image order when assigning that position. Use short concrete
   instructions, normally one or two cues per exercise. The current channel
   chooses its supported card presentation and fallback. Do not also attach
   response media or repeat the card in final text.
6. Use the existing response-media path when the current turn teaches a
   movement, the delivery surface supports response media, and either the
   surface is Linq/iMessage or a routine card is unavailable or unsuitable:
   - If any movement being taught is likely unfamiliar or uncommon, attach at
     least one useful returned catalog image and normally two in the same
     response. Count useful frames per unfamiliar movement, not only across the
     whole response, while keeping the complete response at eight images or
     fewer. Prioritize the least familiar or most technique-sensitive
     movements, and attach the available frames in exercise order so each
     illustrated movement shows its setup, important transitions or side
     changes, and endpoint across the full range of motion. Use at least two
     frames for a simple start/end motion and three or more when an intermediate
     phase is needed to make the path clear.
   - Never split an oversized image set across consecutive unsolicited
     messages. Do not satisfy this rule with one static frame for each of several
     unfamiliar movements. If teaching every movement completely would create a
     batch over eight images, teach fewer movements at a time rather than
     sacrificing sequence clarity. If only one useful catalog frame exists for
     a movement, say the catalog does not yet show the full motion and keep the
     written cue simple rather than presenting that frame as a complete
     walkthrough.
   - Familiarity alone is not a reason to omit images. Omit exercise images only
     when the user explicitly asks for a response without them.
   - Use returned `images[]` with catalog URL and alt text. Construct source as
     `exercise_catalog:<returned-item-id>:<1-based-position-in-images[]>`. Do
     not paste image URLs into message text
     when media delivery exists. If an important movement has no image, say "no
     catalog image yet"; never imply that an image was attached.
   Use the strongest presentation supported by the current channel. Do not
   recreate another platform's UI or default to a long text when the available
   card or media path can present the same answer more clearly.
7. If acute pain or safety requires an immediate action, give the minimal plan
   now and include available catalog media in the same response. For a known
   routine the user has already performed, send a concise reference. Provide
   full steps only when asked, accepted as a walkthrough, or required for
   safety.

Do not assign reporting homework. When subjective response matters, schedule or
offer an appropriate check-in instead.
