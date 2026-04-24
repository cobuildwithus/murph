import Image from "next/image";

interface ExperimentHeroProps {
  image: string;
  title: string;
}

export function ExperimentHero({ image, title }: ExperimentHeroProps) {
  return (
    <div className="relative -mx-6 -mt-8 -mb-16 h-[260px] w-[calc(100%+3rem)] overflow-hidden md:-mx-14 md:-mt-10 md:-mb-20 md:h-[300px] md:w-[calc(100%+7rem)]">
      <Image src={image} alt="" fill className="object-cover" priority />
    </div>
  );
}
