export function NavHeader() {
  return (
    <header className="mx-auto flex max-w-7xl items-center gap-4 px-6 pt-10 md:px-12 lg:px-16">
      <span className="animate-fade-up text-sm font-bold uppercase tracking-[0.2em] text-olive">
        Murph
      </span>
      <span className="h-px w-10 bg-stone-300" aria-hidden="true" />
      <span className="animate-fade-up text-sm tracking-wide text-stone-400">
        Your personal health assistant
      </span>
    </header>
  );
}
