import { cn } from "@/src/lib/utils";

const MURPH_HEADSHOT_SOURCES = [
  "/murph-headshots/murph-headshot-01.png",
  "/murph-headshots/murph-headshot-02.png",
  "/murph-headshots/murph-headshot-03.png",
  "/murph-headshots/murph-headshot-04.png",
] as const;

const DEFAULT_MURPH_HEADSHOT = MURPH_HEADSHOT_SOURCES[0];
const LAST_HEADSHOT_STORAGE_KEY = "murph:last-phone-headshot";
const HEADSHOT_CSS_VAR = "--murph-phone-headshot-url";
const MURPH_HEADSHOT_BOOTSTRAP_SCRIPT = `
(() => {
  const sources = ${JSON.stringify(MURPH_HEADSHOT_SOURCES)};
  const storageKey = ${JSON.stringify(LAST_HEADSHOT_STORAGE_KEY)};
  const cssVar = ${JSON.stringify(HEADSHOT_CSS_VAR)};
  const globalKey = "__murphPhoneHeadshotSource";

  if (!window[globalKey]) {
    let previous = null;
    try {
      previous = window.localStorage.getItem(storageKey);
    } catch {}

    const candidates = sources.filter((source) => source !== previous);
    const pool = candidates.length > 0 ? candidates : sources;
    const randomValues = new Uint32Array(1);
    window.crypto?.getRandomValues(randomValues);
    const seed = randomValues[0] || Math.floor(Math.random() * 4294967296);
    const source = pool[seed % pool.length] || sources[0];

    window[globalKey] = source;
    try {
      window.localStorage.setItem(storageKey, source);
    } catch {}
  }

  document.documentElement.style.setProperty(cssVar, "url('" + window[globalKey] + "')");
})();
`;

export function MurphHeadshotAvatar({ className }: { className?: string }) {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: MURPH_HEADSHOT_BOOTSTRAP_SCRIPT }}
      />
      <div
        aria-hidden="true"
        className={cn(
          "relative z-10 flex size-[38px] items-center justify-center overflow-hidden rounded-full bg-cover bg-center",
          className,
        )}
        style={{
          backgroundImage:
            `var(${HEADSHOT_CSS_VAR}, url('${DEFAULT_MURPH_HEADSHOT}'))`,
        }}
      />
    </>
  );
}
