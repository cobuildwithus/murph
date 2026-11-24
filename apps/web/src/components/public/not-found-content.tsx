import Link from "next/link";

/** The 404's page body: the page reads who's signed in, the design catalog
 * shows both. */
export function NotFoundContent({ authenticated }: { authenticated: boolean }) {
  const backHref = authenticated ? "/home" : "/";
  const backLabel = authenticated ? "Back to Murph home" : "Back to Murph";

  return (
    <div className="max-w-xl text-center">
      <h1 className="font-serif text-7xl font-semibold tracking-tight text-foreground">
        404
      </h1>

      <h2 className="mt-8 font-serif text-3xl font-semibold tracking-tight text-foreground">
        Page not found
      </h2>
      <p className="mx-auto mt-4 max-w-[54ch] text-sm leading-7 text-muted-foreground">
        {authenticated
          ? "That address could not be found. Return to your Murph home to continue, review your settings, or contact support if you need help."
          : "There's no Murph page at this address. Go back to Murph, see what it does, or get in touch."}
      </p>

      <Link
        href={backHref}
        prefetch={false}
        className="mt-10 inline-block rounded-2xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {backLabel}
      </Link>

      <nav
        aria-label="Page recovery links"
        className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm"
      >
        {authenticated ? (
          <>
            <Link className="underline underline-offset-4" href="/settings">
              Settings
            </Link>
            <Link className="underline underline-offset-4" href="/contact">
              Contact support
            </Link>
          </>
        ) : (
          <>
            <Link className="underline underline-offset-4" href="/about">
              About
            </Link>
            <Link className="underline underline-offset-4" href="/contact">
              Contact
            </Link>
            <a className="underline underline-offset-4" href="/llms.txt">
              Agent guide
            </a>
            <a className="underline underline-offset-4" href="/sitemap.xml">
              Sitemap
            </a>
          </>
        )}
      </nav>
    </div>
  );
}
