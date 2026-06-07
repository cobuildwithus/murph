---
name: murph-exercise-images
description: Generate Murph-style instructional exercise images and carousel slides for movements, drills, mobility work, rehab-style exercises, and protocol visuals. Use when a user asks to create, regenerate, or refine exercise visuals with Murph branding, Murph-inspired minimalist protocol styling, precise limb positioning, consistent subject identity/clothing/shoes across image runs, annotated callouts/arrows/comments, or step-by-step exercise carousel sequences.
---

# Murph Exercise Images

## Default Approach

Use this skill with the `imagegen` skill or built-in image generation tool for raster exercise visuals. Generate preview images unless the user asks to place final assets into a project.

Prompt outcome-first: describe the finished visual and success criteria before process details. Keep prompts concise enough to stay legible, but explicit where accuracy is fragile: body position, camera angle, subject consistency, and moving limbs.

Default visual direction:
- Warm cream background, graphite ink, muted olive annotations, sand accents.
- Clean, precise, scientific, warm underneath.
- Realistic instructional illustration with accurate anatomy and restrained shading.
- No hype, gamification, neon, purple-blue gradients, generic fitness-app styling, watermarks, or extra people.
- No Murph wordmark, header bars, footer bands, page numbers, decorative borders, or branded framing unless explicitly requested.
- Keep one readable camera angle across an exercise carousel. Do not switch to flat top-down just to solve left/right ambiguity unless the user asks for a top-down diagram.

Keep text minimal. Prefer generating clean image art and adding final typography outside the image when exact wording matters.

## Annotation Defaults

Instructional exercise slides should include annotations by default unless the user asks for clean art or no text.

Use restrained Murph-style annotations:
- 2-3 short callout labels per slide, placed in whitespace.
- Muted olive dotted leader lines ending in small dots on the relevant body part.
- Muted olive motion arrows for moving parts; use still callout lines for alignment or posture cues.
- Graphite text, sentence case, short phrases such as `Shoulders over wrists`, `Hips over knees`, `Open chest`, `Round spine`.
- Keep labels specific to what changes or what must stay aligned. Avoid generic encouragement.

For static setup slides, prioritize alignment callouts. For movement slides, prioritize motion callouts and one key stability cue. For comparison slides, label each endpoint and add one arrow showing the flow.

If exact label text matters, generate minimal labels in the image and consider adding final typography outside the generated image later.

## Subject Continuity

For carousels or multi-image runs, define a `Subject lock` once and repeat it exactly in every prompt. The goal is to maintain the same person, gender presentation, body type, skin tone, hairstyle, clothing, and shoe/barefoot status across slides.

Use a compact lock like:

```text
Subject lock: same adult across every slide: androgynous athletic build, light-to-medium skin tone, short dark hair, calm neutral expression, charcoal fitted T-shirt, sand athletic pants, barefoot on the mat.
```

Rules:
- If the first generated image is the keeper, reuse that image's visible subject traits as the lock for subsequent prompts.
- Keep clothing and shoes identical across slides unless the user asks for a change. If the exercise is best done barefoot, say barefoot and keep it consistent.
- Keep the same mat, background, rendering style, lighting, and camera angle across the carousel.
- Do not vary age, gender presentation, hairstyle, outfit color, shoes, body type, or facial features between slides.
- If a later image drifts, regenerate that slide with a targeted correction that restates the subject lock first.

## Limb Accuracy

Before prompting, write a tiny movement map for each slide:

```text
Slide N:
Moving limbs:
Stable limbs:
Camera angle:
Body orientation:
Viewer-side check:
Key position:
Must not show:
```

be very careful around positioning of legs/arms and ensure the correct limbs are moving and arent flip flopped.

If you say right arm, do right arm. If you say left leg, do left leg. Be sure based on the orientation of the body that you are moving the correct limb.

For left/right directions, specify anatomical left/right from the subject's body and also translate it into camera-relative placement. Default dead bug camera: oblique three-quarter instructional view from slightly above, not flat top-down. Keep the subject's head toward the left of the image and feet toward the right. The camera looks from the subject's right side, so the subject's right arm/leg are the near-side limbs and the subject's left arm/leg are the far-side limbs.

If the movement could be visually confusing, phrase the prompt with both anatomical side and camera-relative side, for example: "the subject's right arm, the near-side arm closest to the viewer, reaches overhead while the subject's left leg, the far-side leg, extends long and low."

Use subtle non-text visual disambiguation when side accuracy matters: motion arrows on moving limbs, a slightly darker outline on the moving pair, and stable limbs shown quieter. Keep these markers restrained and consistent.

For cross-body exercises, explicitly forbid same-side movement in the prompt. After generation, inspect the image for:
- the correct moving arm and moving leg
- the anatomical-side cue matching the camera-relative placement
- the same camera angle as the rest of the carousel
- stable limbs remaining in the intended position
- no swapped or duplicated limbs
- no impossible anatomy
- no resting when the limb should hover
- no arching when the cue requires a flat back

If a limb is wrong, regenerate that slide with one targeted correction instead of changing the whole visual system.

## Prompt And Validation Loop

Before image generation, define:
- Outcome: the exact image or carousel slide needed.
- Success criteria: pose, camera angle, subject lock, movement map, and minimal text.
- Constraints: Murph style, no clutter, no medical claims, no logos unless requested.

After each generated image, inspect the rendered result before moving on. Check:
- the subject lock stayed consistent
- the camera angle matches the carousel
- the intended movement is understandable
- annotations explain the movement or alignment and point to the correct body parts
- limbs, spine, hands, feet, and head position are correct
- text is minimal and not garbled
- there is no extra person, animal imagery, watermark, logo, or distracting ornament

If the image is usable, continue. If not, regenerate with the smallest targeted correction. Do not add broader prompt complexity unless a specific failure requires it.

## Add Finished Images To The Murph Catalog

When the user wants the generated exercise image available to Murph users, upload the final raster image to Cloudflare Images first and use the public delivery URL. Do not commit image binaries, local file paths, Downloads paths, signed URLs, query strings, or temporary URLs.

Store exercise image links directly in the exercise seed CSV:

- Find the exercise row in `packages/exercise-library/content/seed/*.csv` by id, slug-ish name, or exact movement name.
- Add or update the final `Images` CSV column for that row. If the seed file has no `Images` header yet, add it as the final header column.
- Use this per-image format: `Step label | Alt text | https://imagedelivery.net/<account-hash>/<image-id>/public`.
- Separate multiple images in the same row with ` ;; `.
- Keep `step` short and human-readable, such as `Tabletop setup`, `Cow position`, or `Slow flow`. Keep `alt` as a brief description of what the image shows.
- The generated catalog uses `images[]`; do not add or preserve a singular `image` field.

After editing the CSV, run:

```bash
pnpm --dir packages/exercise-library generate
pnpm --dir packages/exercise-library generate:check
```

For a focused sanity check, inspect the rebuilt row:

```bash
jq '.items[] | select(.slug == "<exercise-slug>" or .id == "<exercise-id>") | {id, slug, images}' packages/exercise-library/generated/exercise-details.json
```

Only edit generated catalog JSON through the generator; never hand-edit `packages/exercise-library/generated/*`.

## Prompt Structure

Use this skeleton and fill only what helps:

```text
Use case: scientific-educational
Asset type: exercise carousel slide <N> of <total>
Primary request: <exercise and phase>. If the exercise name can be literal, clarify it is the exercise, not the object/animal.
Visual direction: warm cream background #f5f0e8, graphite ink #2d3436, muted olive #5a6e32, sand #d4c4a8; calm scientific instructional illustration; no branded framing unless requested.
Scene/backdrop: plain warm cream setting, simple mat, uncluttered.
Subject: one gender-neutral adult in modest neutral athletic clothing.
Subject lock: same person/gender presentation/body type/skin tone/hair/clothing/shoes across every slide.
Composition/framing: square slide, consistent camera angle across the carousel.
Movement map: moving limbs, stable limbs, camera angle, body orientation, viewer-side check, key position, must-not-show.
Annotations: 2-3 short callouts with muted olive dotted leader lines/dots; motion arrows for moving parts.
Text: none or the exact minimal text requested.
Constraints: accurate anatomy, correct limb positioning, no medical claims, no logo unless requested, no watermark, no clutter.
```

## Dead Bug Defaults

For the standard dead bug carousel:
- Setup: arms straight above shoulders; hips and knees at 90 degrees; shins parallel to floor; low back close to mat.
- Brace: ribs down, low back quiet, abdomen subtly highlighted.
- Extend side A: subject's right arm reaches overhead while subject's left leg extends long and low; subject's left arm stays vertical; subject's right knee stays bent over hip.
- Return: both arms vertical and both knees at 90 degrees.
- Extend side B: subject's left arm reaches overhead while subject's right leg extends long and low; subject's right arm stays vertical; subject's left knee stays bent over hip.
- Form check: correct side shows back flat; range-too-long side shows arching or gap under low back; cue should be neutral, such as "shorten range."

Useful constraints for dead bug prompts:
- Opposite arm and leg only; no same-side movement.
- Use the same oblique three-quarter side view for every dead bug slide; do not use flat top-down unless explicitly requested.
- Default camera: head left, feet right, camera slightly above and from the subject's right side; subject's right-side limbs are near-side, subject's left-side limbs are far-side.
- Extend side A camera check: near-side right arm moves overhead with far-side left leg extending; far-side left arm and near-side right knee stay in tabletop.
- Extend side B camera check: far-side left arm moves overhead with near-side right leg extending; near-side right arm and far-side left knee stay in tabletop.
- Extended leg hovers above the floor, not resting.
- Low back stays visibly close to the mat.
- Keep the figure large and readable with comfortable whitespace.
