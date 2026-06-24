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
- a brief final reply that attaches or points to the PDF without claiming delivery unless the runtime actually delivered it

## Workflow

1. Check availability with `command -v typst`. If it is unavailable, do not install anything at runtime; explain that PDF generation is unavailable in this runtime.
2. Create a bounded workspace artifact directory with a short lowercase slug:
   `workdir="$(pwd)/.artifacts/pdf/<short-slug>"; mkdir -p "$workdir"`
3. Write the source to `$workdir/report.typ`. Copy only required local assets into the same directory. Keep the final PDF there so the runtime can publish it.
4. Compile inside that bounded root:
   `typst compile --root "$workdir" --ignore-system-fonts "$workdir/report.typ" "$workdir/report.pdf"`
5. If compilation fails, use the diagnostic to fix the source and compile again.
6. Validate the result:
   - `test -s "$workdir/report.pdf"`
   - `qpdf --check "$workdir/report.pdf"`
   - `pdfinfo "$workdir/report.pdf"`
   - `pdftotext -enc UTF-8 -nopgbrk "$workdir/report.pdf" -`
7. For multi-page or visually complex documents, render representative pages with `pdftoppm` and inspect them for clipping, awkward breaks, tiny text, crowded tables, or missing images. Revise and recompile when needed.
8. Attach or return the final PDF through the available file-delivery surface. If the runtime has no file-delivery surface, state that clearly and provide the safe local output path; do not claim it was sent.

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
