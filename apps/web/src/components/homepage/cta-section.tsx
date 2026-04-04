export function CtaSection() {
  return (
    <section className="border-t border-stone-200 bg-olive">
      <div className="mx-auto max-w-7xl px-6 py-20 text-center text-white md:px-12 md:py-28 lg:px-16">
        <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
          Start using Murph today.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-white/60">
          Sign up with your phone number. No app to download, no account to
          configure. Just text and go.
        </p>
        <div className="mt-8">
          <a
            href="#signup-title"
            className="inline-flex rounded bg-white px-7 py-3.5 font-bold text-olive transition-colors hover:bg-cream-dark"
          >
            Get started free
          </a>
        </div>
      </div>
    </section>
  );
}
