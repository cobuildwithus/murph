import Image from "next/image";

interface ExperimentHeroProps {
  image: string;
}

export function ExperimentHero({ image }: ExperimentHeroProps) {
  return (
    <div className="relative h-[180px] w-full overflow-hidden rounded-2xl outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10 md:h-[220px]">
      <Image
        src={image}
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
        preload
      />
    </div>
  );
}
