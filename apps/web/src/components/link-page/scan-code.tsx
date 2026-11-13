import qrcode from "qrcode-generator";

/**
 * A link as a code to scan, for a link page on a computer: the Murph app is on
 * the phone. Drawn into the page itself, so it needs no script. Sits beside
 * the card where the view is wide and under it where it is narrow.
 */
export function LinkPageScanCode(props: { detail: string; label: string; title: string; url: string }) {
  const qr = qrcode(0, "M");
  qr.addData(props.url);
  qr.make();
  return (
    <aside className="mx-auto flex w-[17rem] shrink-0 flex-col items-center gap-[18px] pb-16 text-center @5xl:mx-0 @5xl:pb-0">
      <div
        aria-label={props.label}
        className="size-[17rem] overflow-hidden rounded-[20px] bg-[#FFFCF6] [&_path]:fill-[#1C1915] [&_rect]:fill-[#FFFCF6] [&_svg]:size-full"
        dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 1, margin: 4, scalable: true }) }}
        role="img"
      />
      <h2 className="font-serif text-3xl font-semibold leading-[34px]">{props.title}</h2>
      <p className="text-[15px] font-medium leading-[22px] text-[#FFFCF6]/60">{props.detail}</p>
    </aside>
  );
}
