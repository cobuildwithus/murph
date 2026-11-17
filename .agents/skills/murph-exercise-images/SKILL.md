---
name: murph-exercise-images
description: Generate Murph-style instructional exercise images and carousel slides for movements, drills, mobility work, rehab-style exercises, and protocol visuals. Use when a user asks to create, regenerate, or refine exercise visuals with Murph styling, precise limb positioning, a consistent subject across slides, annotated callouts and arrows, or step-by-step carousel sequences.
---

# Murph Exercise Images

Generate with the `imagegen` skill or the built-in image tool. Produce previews
unless the user asks for final assets in a project. Describe the finished image
first, then spell out only what image models get wrong: body position, camera
angle, subject consistency and which limbs move.

## Look

- Warm cream background `#f5f0e8`, graphite ink `#2d3436`, muted olive
  annotations `#5a6e32`, sand accents `#d4c4a8`.
- Realistic instructional illustration: accurate anatomy, restrained shading,
  calm and scientific.
- One adult on a plain mat. No wordmark, header or footer bands, page numbers,
  borders, watermark, neon, gradients or fitness-app styling unless asked.
- Keep text minimal. When exact wording matters, generate clean art and add
  the type outside the image.

## Slide count

Pick 2 to 5 slides from the movement and write down the count and why before
generating:

- 2: one start frame and one movement or hold frame explain it.
- 3: setup plus one important transition, end range or form check.
- 4: alternating, cross-body or side-sensitive movements that need setup plus
  side A and side B, or a multi-phase sequence.
- 5: all of that plus a common mistake or form correction.

Reject a carousel that has the right number of images but skips a side, a
transition or a form cue the exercise needs.

## Annotations

Slides carry annotations unless the user asks for clean art:

- 2 to 3 short labels per slide in whitespace, graphite, sentence case:
  `Shoulders over wrists`, `Hips over knees`, `Round spine`.
- Muted olive dotted leader lines ending in a dot on the body part, and olive
  arrows on whatever moves.
- Setup slides label alignment; movement slides label the motion and one
  stability cue; comparison slides label each end and show the flow.
- Visible labels say what to do (`Reach forward`, `Heels planted`). Keep
  `Right arm`, `foreground leg` and similar terms in the prompt only: models
  often point such a label at the wrong limb.

## Same subject, same camera

Write one subject lock and repeat it word for word in every prompt:

```text
Subject lock: same adult across every slide: androgynous athletic build, light-to-medium skin tone, short dark hair, calm neutral expression, charcoal fitted T-shirt, sand athletic pants, barefoot on the mat.
```

If the first image is the keeper, copy its visible traits into the lock. Mat,
background, lighting, rendering and camera angle are part of the lock too.
Change the camera only when the user asks or the angle cannot show the
movement. A slide that gets the limbs right by switching view is still a
reject: regenerate it at the original angle with tighter limb wording.

## Getting the limbs right

Wrong or swapped limbs are the main failure. Before prompting, write a
movement map per slide:

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

- Name the exact limb (`subject's right arm`, `subject's left leg`), never
  `one arm` or `switch sides`, and give its place in the frame in the same
  sentence: "the subject's right arm, the near-side arm closest to the viewer,
  reaches overhead while the subject's left leg, the far-side leg, extends
  long and low."
- Where limbs overlap (side-profile quadruped, plank, crawling), describe the
  pose by foreground and background first, because models misread left and
  right there. List all four limbs:

  ```text
  1. FOREGROUND ARM: reaches forward, closest to viewer, not planted.
  2. BACKGROUND ARM: stays planted, visible behind the torso as support.
  3. FOREGROUND LEG: stays planted as the knee/lower leg under the near hip.
  4. BACKGROUND LEG: reaches backward, visibly offset behind/above the planted foreground knee.
  ```

- A moving near-side limb must connect to the near shoulder or hip, with no
  planted limb drawn under that same joint. Show the far-side support limb
  slightly behind the body, lighter or partly hidden, but visible: all four
  limbs stay countable.
- For cross-body work, say in the prompt that same-side movement is wrong.
- A slightly darker outline on the moving pair helps the reader tell sides
  apart.

## Check each image before the next

Look at the rendered image, not the prompt:

- the moving and stable limbs match the map, with no swapped, duplicated or
  missing limb and no impossible anatomy;
- every leader line, dot and arrow lands on the right body part;
- subject, outfit and camera match the accepted slides;
- a hovering limb hovers and a flat back is flat;
- text is short and spelled right; no extra person, logo or ornament.

When something is wrong, regenerate that slide with one targeted correction
that restates the subject lock. Add prompt detail only for a failure you saw.

## Prompt skeleton

```text
Use case: scientific-educational
Asset type: exercise carousel slide <N> of <total>
Primary request: <exercise and phase>. If the exercise name can be literal, clarify it is the exercise, not the object/animal.
Visual direction: warm cream background #f5f0e8, graphite ink #2d3436, muted olive #5a6e32, sand #d4c4a8; calm scientific instructional illustration; no branded framing unless requested.
Scene/backdrop: plain warm cream setting, simple mat, uncluttered.
Subject lock: <the lock, verbatim>
Composition/framing: square slide, consistent camera angle across the carousel.
Movement map: moving limbs, stable limbs, camera angle, body orientation, viewer-side check, key position, must-not-show.
Annotations: 2-3 short callouts with muted olive dotted leader lines/dots; motion arrows for moving parts.
Text: none or the exact minimal text requested.
Constraints: accurate anatomy, correct limb positioning, no medical claims, no logo unless requested, no watermark, no clutter.
```

## Dead bug reference

A worked example of the rules above:

- Camera: oblique three-quarter view from slightly above, head left, feet
  right, seen from the subject's right side. The right arm and leg are
  near-side; the left are far-side. Same view on every slide.
- Setup: arms straight above shoulders, hips and knees at 90 degrees, shins
  parallel to the floor, low back close to the mat.
- Brace: ribs down, low back quiet, abdomen subtly highlighted.
- Side A: near-side right arm reaches overhead while far-side left leg
  extends long and low. Left arm stays vertical; right knee stays over the hip.
- Return: both arms vertical, both knees at 90 degrees.
- Side B: far-side left arm reaches overhead while near-side right leg
  extends. Right arm stays vertical; left knee stays over the hip.
- Form check: one side with the back flat, one with the range too long and
  the low back arching; neutral cue such as "shorten range".
- The extended leg hovers above the floor and the low back stays near the mat.

## Upload to Cloudflare Images

```bash
python3 .agents/skills/murph-exercise-images/scripts/upload_cloudflare_image.py --file <image.png>
python3 .agents/skills/murph-exercise-images/scripts/upload_cloudflare_image.py --latest-generated
```

The script reads `CLOUDFLARE_IMAGES_API_KEY` or `CLOUDFLARE_IMAGES_API_TOKEN`
(and `CLOUDFLARE_ACCOUNT_ID` when set) from the environment or the working
directory's `.env`, and prints safe JSON: `success`, image `id`, `filename`,
`variants` and sanitized errors. Give the user the public `variants` URL. Keep
`.env` contents, tokens, account IDs and local paths out of your output, and
keep metadata neutral, for example
`{"purpose":"exercise-image","source":"generated-image"}`.

## Add finished images to the catalog

Upload first, then store the public delivery URL in the exercise seed CSV.
Image binaries, local paths, signed URLs and query strings stay out of the
repo.

- Find the row in `packages/exercise-library/content/seed/*.csv` by id or
  name and fill the final `Images` column, adding the header if the file has
  none.
- One image is `Step label | Alt text | https://imagedelivery.net/<account-hash>/<image-id>/public`;
  separate several with ` ;; `. Step labels are short (`Tabletop setup`,
  `Cow position`); alt text briefly says what the image shows.
- The generated catalog uses `images[]`; there is no singular `image` field.
  Change generated JSON only through the generator:

```bash
pnpm --dir packages/exercise-library generate
pnpm --dir packages/exercise-library generate:check
jq '.items[] | select(.slug == "<exercise-slug>") | {id, slug, images}' packages/exercise-library/generated/exercise-details.json
```
