import { cn } from "@/src/lib/utils";

export const MURPH_HEADSHOT_SOURCES = [
  "/murph-headshots/murph-headshot-01-avatar.avif",
  "/murph-headshots/murph-headshot-02-avatar.avif",
  "/murph-headshots/murph-headshot-03-avatar.avif",
  "/murph-headshots/murph-headshot-04-avatar.avif",
] as const;

export type MurphHeadshotSrc = (typeof MURPH_HEADSHOT_SOURCES)[number];

export const DEFAULT_MURPH_HEADSHOT = MURPH_HEADSHOT_SOURCES[0];

export function pickRandomMurphHeadshotSrc(): MurphHeadshotSrc {
  const index = Math.floor(Math.random() * MURPH_HEADSHOT_SOURCES.length);
  return MURPH_HEADSHOT_SOURCES[index] ?? DEFAULT_MURPH_HEADSHOT;
}

export function MurphHeadshotAvatar({
  className,
  src,
}: {
  className?: string;
  src: MurphHeadshotSrc;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative z-10 flex size-[38px] items-center justify-center overflow-hidden rounded-full bg-cover bg-center",
        className,
      )}
      style={{
        backgroundImage: `url('${src}')`,
      }}
    />
  );
}
