export function MurphSafeFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-8 text-sm leading-6 text-muted-foreground sm:px-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <p className="max-w-3xl">
          Murph organizes source data for informational use. Product tests
          describe specific samples and do not certify that a product is safe,
          unsafe, or unchanged.
        </p>
        <a
          href="https://www.withmurph.ai"
          referrerPolicy="no-referrer"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-md text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          About Murph
        </a>
      </div>
    </footer>
  );
}
