import Link from "next/link";

export function MurphSafeHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <Link
          href="/search"
          prefetch={false}
          className="group inline-flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="font-serif text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
            Murph Safe
          </span>
          <span className="hidden border-l border-border pl-3 font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground sm:inline">
            PRODUCT DATA
          </span>
        </Link>

        <nav aria-label="Murph Safe">
          <a
            href="/api/public/v1/openapi.json"
            referrerPolicy="no-referrer"
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            API specification
          </a>
        </nav>
      </div>
    </header>
  );
}

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
