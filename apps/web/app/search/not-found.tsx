import Link from "next/link";

export default function MurphSafeNotFound() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
      <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
        PRODUCT RECORD
      </p>
      <h1 className="mt-4 max-w-2xl font-serif text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl">
        Product not found
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
        This product record is unavailable. It may have been removed, merged,
        or replaced.
      </p>
      <Link
        href="/search"
        prefetch={false}
        className="mt-8 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Search another product
      </Link>
    </main>
  );
}
