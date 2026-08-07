# Remove redundant MuPDF runner dependency

## Goal

Delete MuPDF from the hosted runner image because production parsing, PDF
generation, validation, text extraction, and page rendering are already owned
by Typst, qpdf, and Poppler. Preserve every supported PDF behavior while
reducing the compressed image pulled for cold containers.

## Evidence and constraints

- Production code and the assistant PDF skill do not invoke `mutool`.
- The current MuPDF install and its exclusive dependencies account for
  61,592,280 image bytes in an exact rebuilt comparison.
- Keep qpdf, Poppler, Typst, `file`, and all parser behavior unchanged.
- Update the image smoke and durable deployment documentation to match the
  supported toolchain.
- Compare the exact baseline and candidate through the established-v2-R2
  hosted-local benchmark. Do not deploy or merge.

## Verification

1. [x] Run focused image-contract tests and Cloudflare typecheck.
2. [x] Build the exact final image and attempt its full Docker smoke.
3. [x] Prove PDF create, validate, extract, and render behavior without MuPDF.
4. [x] Run paired hosted-local cold samples and report image-size and endpoint
   results separately, without treating local cached-image timing as a
   production image-pull measurement.
5. [x] Complete the required specialist and final ReviewGPT gates before handoff.

## Results

- The exact rebuilt compressed image shrank from 547,637,182 bytes to
  486,044,902 bytes: 61,592,280 bytes, or 11.25 percent.
- The candidate image no longer contains `mupdf-tools` or its exclusive
  `libmujs2`, `libgumbo1`, and `libjbig2dec0` packages.
- Direct container proof created a PDF and validated, extracted text from, and
  rendered it with the retained Typst, qpdf, and Poppler toolchain.
- The full final-image smoke reached the nested Codex Linux sandbox check but
  the ARM-hosted amd64 Docker emulation returned `Function not implemented` for
  the inner seccomp layer. The deployment guide already documents that this
  proof requires a native amd64 Docker host.
- In the established-v2-R2 hosted-local ABBA comparison, candidate medians were
  15.5 ms slower from accepted input to provider start, 1 ms slower to delivery,
  and 2 ms slower from webhook to provider start. Node startup was 9.5 ms
  faster. These are noise-scale results, so this deletion receives zero
  cold-start latency credit.
- `container-image-contract.test.ts` passed 11 tests, Cloudflare typecheck
  passed, `pnpm docs:drift` passed, and `git diff --check` passed.
- The preliminary specialist pass found one reporting-only arithmetic mismatch.
  Re-inspecting the exact local images confirmed the raw totals above; direct
  subtraction yields 61,592,280 bytes and 11.2469 percent, rounded to 11.25
  percent. The completed plan and PR evidence now use those consistent values.
- Final ReviewGPT round 1 passed with no qualifying code findings. Repository-
  wide inspection also confirmed no production `mutool` invocation remains.

Status: completed
Updated: 2026-08-06
Completed: 2026-08-06
