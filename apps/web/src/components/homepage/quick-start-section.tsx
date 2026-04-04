export function QuickStartSection({ installCommandUrl }: { installCommandUrl: string }) {
  return (
    <section className="border-t border-stone-200">
      <div className="mx-auto max-w-7xl px-6 py-20 md:px-12 md:py-24 lg:px-16">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-olive">
          Quick start
        </p>
        <h2 className="mb-10 max-w-md text-3xl font-bold tracking-tight text-stone-900 md:text-4xl">
          Up and running in one command.
        </h2>
        <div className="overflow-hidden rounded-lg border border-stone-800 bg-stone-900">
          <div className="flex items-center gap-2 border-b border-stone-800 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-400/80" />
            <span className="h-3 w-3 rounded-full bg-amber-400/80" />
            <span className="h-3 w-3 rounded-full bg-green-400/80" />
            <span className="ml-4 text-xs text-stone-500">terminal</span>
          </div>
          <div className="space-y-4 p-6 font-mono text-sm leading-relaxed md:p-8">
            <p className="text-stone-500"># Install Murph and launch setup</p>
            <p className="break-all">
              <span className="text-olive-light">$</span>{" "}
              <span className="text-white">
                curl -fsSL {installCommandUrl} | bash
              </span>
            </p>
            <div className="border-t border-stone-800 pt-4">
              <p className="text-stone-500"># Start chatting</p>
              <p>
                <span className="text-olive-light">$</span>{" "}
                <span className="text-white">murph chat</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
