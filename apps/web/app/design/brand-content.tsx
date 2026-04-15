/* eslint-disable @next/next/no-img-element */

export function BrandContent() {
  return (
    <>
      {/* ━━━ HEADER ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pt-12 pb-16 sm:px-10 lg:px-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6B7F5A]">
          Brand Guidelines
        </p>
        <h1 className="mt-4 font-serif text-[clamp(2.5rem,5vw,4rem)] font-normal leading-[0.95] tracking-[-0.03em] text-[#1A1F16]">
          Warm signal,
          <br />
          quiet horizon.
        </h1>
        <p className="mt-5 max-w-md text-base leading-relaxed text-[#5C5A52]">
          Murph imagery feels spacious, warm, and quietly cinematic. Real light,
          real distance, no performance theatre.
        </p>
      </section>

      {/* ━━━ LOGO ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">
        <SectionLabel>Logo</SectionLabel>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="flex items-center justify-center rounded-2xl border border-[#e5e1d8] bg-[#FAF8F4] px-16 py-20">
            <img src="/logo.svg" alt="Murph logo on light" className="h-11" />
          </div>
          <div className="flex items-center justify-center rounded-2xl bg-[#1A1F16] px-16 py-20">
            <img src="/logo-dark.svg" alt="Murph logo on dark" className="h-11" />
          </div>
        </div>
        <div className="mt-6 grid gap-6 text-sm leading-relaxed text-[#5C5A52] sm:grid-cols-2">
          <p>
            The mark is a field of quiet data points drawn into a warm center.
            Clarity without coldness — evidence, care, and measurable change.
          </p>
          <p>
            Use the wordmark on light and dark backgrounds. Keep it calm,
            spacious, and uncluttered. Don&apos;t lock it up with taglines.
          </p>
        </div>
      </section>

      {/* ━━━ COLORS ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">
        <SectionLabel>Palette</SectionLabel>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Swatch hex="#1A1F16" name="Dark" />
          <Swatch hex="#6B7F5A" name="Olive" />
          <Swatch hex="#B5C4A1" name="Sage" />
          <Swatch hex="#C4956A" name="Amber" />
          <Swatch hex="#8B6840" name="Deep Amber" />
          <Swatch hex="#FAF8F4" name="Cream" border />
        </div>
      </section>

      {/* ━━━ TYPOGRAPHY ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">
        <SectionLabel>Typography</SectionLabel>
        <div className="mt-8 grid gap-8 sm:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-[#e5e1d8] bg-[#FAF8F4]">
            <div className="px-8 pt-10 pb-8">
              <p className="font-serif text-[56px] font-normal leading-[0.95] tracking-[-0.04em] text-[#1A1F16]">Fraunces</p>
              <p className="mt-1 font-serif text-[56px] font-semibold leading-[0.95] tracking-[-0.04em] text-[#1A1F16]">Fraunces</p>
            </div>
            <div className="border-t border-[#e5e1d8] px-8 py-5">
              <p className="text-xs text-[#9C9A92]">Serif — headlines &amp; wordmark</p>
              <p className="mt-1 font-mono text-[11px] text-[#9C9A92]">Weights 400, 600 · Optical size 9–144</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl bg-[#1A1F16]">
            <div className="px-8 pt-10 pb-8">
              <p className="text-[56px] font-normal leading-[0.95] tracking-[-0.02em] text-[#FAF8F4]">DM Sans</p>
              <p className="mt-1 text-[56px] font-semibold leading-[0.95] tracking-[-0.02em] text-[#FAF8F4]">DM Sans</p>
            </div>
            <div className="border-t border-white/10 px-8 py-5">
              <p className="text-xs text-[#9C9A92]">Sans — body, labels &amp; UI</p>
              <p className="mt-1 font-mono text-[11px] text-[#9C9A92]">Variable weight · Subsets latin</p>
            </div>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-[#e5e1d8] bg-[#FAF8F4] px-8 py-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="font-serif text-[28px] font-normal leading-tight tracking-[-0.03em] text-[#1A1F16]">Display</p>
              <p className="mt-1 font-mono text-[11px] text-[#9C9A92]">Fraunces 400 · –0.03em</p>
            </div>
            <div>
              <p className="text-base font-normal leading-relaxed text-[#5C5A52]">Body text stays in DM Sans at comfortable reading sizes with generous line height.</p>
              <p className="mt-1 font-mono text-[11px] text-[#9C9A92]">DM Sans 400 · 16px</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6B7F5A]">Section Label</p>
              <p className="mt-2 font-mono text-[11px] text-[#9C9A92]">DM Sans 500 · 11px · 0.18em</p>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ IMAGE DIRECTION ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">
        <SectionLabel>Image Direction</SectionLabel>
        <div className="relative mt-6 overflow-hidden rounded-2xl">
          <img src="/hero.jpg" alt="Murph canonical hero — solitary figure on a warm horizon" className="aspect-[2/1] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1f16]/50 to-transparent" />
          <p className="absolute bottom-5 left-6 font-serif text-lg text-white/80">Wide horizon. Small figure. Warm light. Room for copy.</p>
        </div>
        <div className="mt-8 grid gap-x-12 gap-y-6 text-sm leading-relaxed text-[#5C5A52] sm:grid-cols-2">
          <Rule title="Big horizon, small human">Wide scenes with large negative space. One person held small, off-center, near an edge. The scene stays open and breathable.</Rule>
          <Rule title="Warm light over loud color">Amber-gold sunrise or sunset light, soft haze, low-contrast tonal shifts. If it feels neon, icy, or synthetic — it&apos;s not Murph.</Rule>
          <Rule title="Calm before information">A quiet field where signal can emerge. No busy props, tech hardware, graphs, dashboards, or floating metrics.</Rule>
          <Rule title="Space for copy">Preserve a calm side for typography. When cropping, keep one clear text lane rather than centering the subject.</Rule>
        </div>
        <div className="mt-10 rounded-xl border border-[#e5e1d8] bg-[#FAF8F4] p-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7F5A]">Avoid</p>
          <p className="mt-2 text-sm leading-relaxed text-[#5C5A52]">Labs. Floating UI. Stock-wellness smiles. Neon. Glossy biohacker aesthetics. Saturated teal-purple gradients. Victory poses. Clinical sterility.</p>
        </div>
      </section>

      {/* ━━━ INTERACTIVE HERO CONCEPT ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">
        <SectionLabel>Interactive Hero Concept</SectionLabel>
        <div className="relative mt-6 overflow-hidden rounded-2xl bg-[#1A1F16]">
          <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 30% 60%, rgba(160,122,78,0.3) 0%, transparent 50%), radial-gradient(circle at 70% 35%, rgba(140,104,64,0.15) 0%, transparent 40%), radial-gradient(circle at 55% 80%, rgba(196,149,106,0.12) 0%, transparent 35%)" }} />
          <div className="relative flex min-h-[480px] flex-col justify-between p-8 sm:p-10">
            <div className="flex items-center justify-between">
              <img src="/logo-dark.svg" alt="" className="h-5 opacity-80" />
              <span className="text-xs text-[#EEE5D0]/40">cursor-reactive background</span>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#C4956A]/60">Cursor-reactive background</p>
              <h2 className="mt-3 max-w-md font-serif text-[clamp(2rem,4vw,2.8rem)] font-normal leading-[0.96] tracking-[-0.05em] text-[#FAF8F4]">Data that moves softly around your attention.</h2>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#EEE5D0]/75">Large blurred dot clusters drift in the background. Hover shifts the field gently instead of screaming for attention.</p>
              <div className="mt-6 flex items-center gap-4">
                <span className="rounded-lg border border-[#FAF8F4]/20 px-4 py-2.5 text-sm font-medium text-[#FAF8F4]">Start an experiment</span>
                <span className="text-sm text-[#EEE5D0]/50">Reduced motion → still image</span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-[#e5e1d8] bg-[#FAF8F4] p-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7F5A]">Background CSS</p>
          <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-[#5C5A52]">{`/* Ambient dot-field layers */
background:
  radial-gradient(circle at 30% 60%, rgba(160,122,78,0.3) 0%, transparent 50%),
  radial-gradient(circle at 70% 35%, rgba(140,104,64,0.15) 0%, transparent 40%),
  radial-gradient(circle at 55% 80%, rgba(196,149,106,0.12) 0%, transparent 35%);

/* Photo overlay — hero & OG */
background: linear-gradient(180deg,
  rgba(26,31,22,0.12) 0%, rgba(26,31,22,0.50) 100%);`}</pre>
        </div>
      </section>

      {/* ━━━ BACKGROUND EXPLORATIONS ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-20 sm:px-10 lg:px-16">
        <SectionLabel>Background Explorations</SectionLabel>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#5C5A52]">Testing built-in gradient types against the Murph motion language. Goal: large blurred fields, warm amber light, low-contrast motion.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-[#e5e1d8]">
            <div className="aspect-[4/3]" style={{ background: "radial-gradient(circle at 45% 50%, rgba(210,190,140,0.6), rgba(200,170,120,0.3) 30%, rgba(230,220,200,0.5) 60%, #F0EBE0 80%)" }} />
            <div className="bg-[#FAF8F4] p-5">
              <p className="font-serif text-lg text-[#1A1F16]">Mesh Gradient</p>
              <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-[#5C5A52]">{`radial-gradient(
  circle at 45% 50%,
  rgba(210,190,140,0.6),
  rgba(200,170,120,0.3) 30%,
  rgba(230,220,200,0.5) 60%,
  #F0EBE0 80%
)`}</pre>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#e5e1d8]">
            <div className="aspect-[4/3]" style={{ background: "radial-gradient(circle at 40% 45%, rgba(140,104,64,0.5) 0%, transparent 30%), radial-gradient(circle at 65% 55%, rgba(100,80,50,0.3) 0%, transparent 25%), linear-gradient(180deg, #2A2518 0%, #1A1F16 100%)" }} />
            <div className="bg-[#FAF8F4] p-5">
              <p className="font-serif text-lg text-[#1A1F16]">Multi-layer Radial</p>
              <pre className="mt-3 overflow-x-auto font-mono text-[11px] leading-relaxed text-[#5C5A52]">{`radial-gradient(circle at 40% 45%,
  rgba(140,104,64,0.5) 0%, transparent 30%),
radial-gradient(circle at 65% 55%,
  rgba(100,80,50,0.3) 0%, transparent 25%),
linear-gradient(180deg,
  #2A2518 0%, #1A1F16 100%)`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* ━━━ AI IMAGE PROMPTS ━━━ */}
      <section className="mx-auto max-w-5xl px-6 pb-24 sm:px-10 lg:px-16">
        <SectionLabel>AI Image Prompts</SectionLabel>
        <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#5C5A52]">Starting points for generating hero images, social crops, and OG visuals with AI tools.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <PromptCard label="Prompt formula">Wide horizon. Lone figure. Warm haze. Low contrast. Real landscape.</PromptCard>
          <PromptCard label="Starter prompt" dark>{`warm amber horizon\nlone figure near edge\nquiet negative space\nno UI overlays, no neon`}</PromptCard>
          <PromptCard label="Remember" cream>Keep one calm side for copy. Let light carry the mood.</PromptCard>
        </div>
      </section>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6B7F5A]">{children}</p>;
}

function Swatch({ hex, name, border }: { hex: string; name: string; border?: boolean }) {
  return (
    <div>
      <div className={`aspect-square rounded-xl ${border ? "border border-[#e5e1d8]" : ""}`} style={{ backgroundColor: hex }} />
      <p className="mt-2 text-xs font-medium text-[#1A1F16]">{name}</p>
      <p className="font-mono text-[11px] text-[#9C9A92]">{hex}</p>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium text-[#1A1F16]">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function PromptCard({ label, children, dark, cream }: { label: string; children: React.ReactNode; dark?: boolean; cream?: boolean }) {
  const bg = dark ? "bg-[#1A1F16]" : cream ? "bg-[#FAF3E0]" : "bg-[#FAF8F4]";
  const textColor = dark ? "text-[#FAF8F4] font-mono" : cream ? "text-[#5C5A52]" : "text-[#1A1F16]";
  return (
    <div className={`rounded-xl ${bg} p-5`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#6B7F5A]">{label}</p>
      <p className={`mt-3 whitespace-pre-line text-sm leading-relaxed ${textColor}`}>{children}</p>
    </div>
  );
}
