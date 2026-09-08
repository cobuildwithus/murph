---
name: pdf
description: Create polished PDF documents with the installed Typst CLI; not for reading incoming PDFs.
---

# PDF creation

Create a readable, polished PDF that satisfies the user's requested content and can be checked before delivery. Use this skill when the user asks for a PDF or when a substantial health-relevant report is best delivered as a document.

## Outcome

Finish with:

- one valid `.pdf` file
- a clear, safe filename
- content that matches the requested scope
- for delivery requests, a PDF handed to `murph.send_vault_file` with a truthful approval or delivery outcome; for save-only requests, a document at its durable owner path

## Workflow

1. Before offering an attached PDF or starting a send-now request, confirm `murph.send_vault_file` is available for this conversation. If it is unavailable, explain that you cannot attach a PDF here and offer the requested content in the chat. A local path is not a downloadable attachment. If the user explicitly wants a saved document without delivery, keep it at its ordinary durable owner path.
2. Check availability with `command -v typst`. If it is unavailable, do not install anything at runtime; explain that PDF generation is unavailable in this runtime.
3. Write the Typst source and required local assets inside a bounded `.artifacts/pdf/<short-slug>` workspace directory. For an authorized send-now request, write the final PDF bytes directly to `.runtime/operations/assistant/generated-deliveries/<flat-filename>.pdf`, relative to the active vault. Do not copy or move existing files into delivery staging. Keep source and preview files outside delivery staging.
4. Compile with `typst compile --root <source-directory> --ignore-system-fonts <source-file> <final-pdf-path>`.
5. If compilation fails, use the diagnostic to fix the source and compile again.
6. Validate the final PDF with `test -s`, `qpdf --check`, `pdfinfo`, and `pdftotext -enc UTF-8 -nopgbrk`. For multi-page or visually complex documents, render representative pages with `pdftoppm`, inspect them, and correct clipping, awkward breaks, tiny text, crowded tables, or missing images.
7. For a delivery request, call `murph.send_vault_file` with the exact final vault-relative ref. Follow its approval result: for pending approval, briefly explain approval is required and let the runtime add the link; for approved, call `finish_without_reply` and let the runtime deliver the attachment. Do not claim delivery before sent evidence, expose a local path as a download, or recreate a file whose send is already pending.

## Authoring rules

- Lead with the user's requested outcome. Do not add sections simply to make the report longer.
- Use a clear title, a short executive summary for longer reports, descriptive headings, page numbers, and a sources section when research is included.
- Prefer prose and short lists. Use tables only when comparison is easier to read in columns.
- Keep body text around 10–11 pt with comfortable margins and line spacing.
- Use semantic Typst headings, lists, figures, links, and tables so the tagged PDF retains useful structure.
- Add alternative descriptions for meaningful images.
- Keep source titles readable and clickable. Include raw source URLs only when the user requested links or when the document itself needs them.
- Use page breaks deliberately; avoid orphaned headings and nearly empty pages.
- Use only Typst built-ins and local assets. Do not import remote Typst packages.
- Do not fetch remote images during compilation. Download necessary public images through the approved web path first, then use the local copy.
- Use the embedded fonts for ordinary documents. When the content needs glyphs they do not cover, include an appropriate local `.ttf` or `.otf` and pass a bounded `--font-path` inside the working directory.
- Preserve evidence boundaries. Do not invent sources, quotations, metrics, medical certainty, or user health facts to make the document feel complete.
- Never include secrets, credentials, environment values, sensitive local paths, or unrelated private data.

## Starter source

```typst
#set document(
  title: "Report title",
  author: "Murph",
)

#set page(
  paper: "us-letter",
  margin: (x: 0.85in, y: 0.8in),
  numbering: "1",
  number-align: center,
)

#set text(font: "Libertinus Serif", size: 10.5pt, lang: "en")
#set par(justify: true, leading: 0.7em)
#set heading(numbering: "1.")

#align(center)[
  #text(size: 24pt, weight: "bold")[Report title]
  #v(0.35em)
  #text(size: 12pt, fill: luma(40%))[Short subtitle]
  #v(0.9em)
  #text(size: 9pt, fill: luma(55%))[Prepared by Murph]
]

#pagebreak()

= Executive summary

State the central conclusion first.

= Findings

== First finding

Explain the evidence and uncertainty.

#table(
  columns: (1.2fr, 1fr, 2fr),
  inset: 6pt,
  stroke: 0.5pt + luma(82%),
  [*Item*], [*Status*], [*Notes*],
  [Example], [Current], [Concise supporting detail],
)

= Sources

+ #link("https://example.com")[Source title]
```

Stop when the requested content is complete, validation passes, and representative pages look clean.
