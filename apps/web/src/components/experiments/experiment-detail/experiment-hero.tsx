import Image from "next/image";

interface ExperimentHeroProps {
  image: string;
}

export function ExperimentHero({ image }: ExperimentHeroProps) {
  return (
    <div className="relative h-[180px] w-full overflow-hidden rounded-2xl border border-border/50 md:h-[220px]">
      <Image src={image} alt="" fill className="object-cover" priority />
    </div>
  );
}
