import sharp from 'sharp';

const WIDTH = 177;
// About 13 px of the stored map either side of the coast.
const BAND = 3;
type Mask = { sea: Uint8Array; skip: Uint8Array; count: number };

async function mask(bytes: Uint8Array, height: number, isSea: (r: number, g: number, b: number) => boolean, isCloud: (r: number, g: number, b: number) => boolean): Promise<Mask> {
  const { data } = await sharp(bytes).resize(WIDTH, height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sea = new Uint8Array(WIDTH * height), skip = new Uint8Array(WIDTH * height);
  for (let i = 0; i < sea.length; i += 1) {
    const r = data[i * 3]!, g = data[i * 3 + 1]!, b = data[i * 3 + 2]!;
    skip[i] = isCloud(r, g, b) ? 1 : 0;
    sea[i] = isSea(r, g, b) ? 1 : 0;
  }
  return { sea, skip, count: sea.length };
}

/**
 * How well a painting keeps the photo's coast where it was: the share of
 * pixels within a few points of the photo's coastline whose sea or land
 * matches, ignoring white cloud. 1 for a frame with no coast in it.
 */
export async function coastAgreement(photo: Uint8Array, painting: Uint8Array, aspect: number): Promise<number> {
  const height = Math.max(1, Math.round(WIDTH / aspect));
  const white = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 35;
  const [a, b] = await Promise.all([
    mask(photo, height, (r, g, bl) => bl > r + 12 && r + g + bl < 330, white),
    mask(painting, height, (r, g, bl) => bl > r + 25 && bl >= g - 12, white),
  ]);
  const at = (x: number, y: number) => y * WIDTH + x;
  let agree = 0, seen = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const i = at(x, y);
    if (a.skip[i] || b.skip[i]) continue;
    let coast = false;
    for (let dy = -BAND; dy <= BAND && !coast; dy += 1) for (let dx = -BAND; dx <= BAND && !coast; dx += 1) {
      const nx = x + dx, ny = y + dy;
      coast = nx >= 0 && ny >= 0 && nx < WIDTH && ny < height && a.sea[at(nx, ny)] !== a.sea[i];
    }
    if (!coast) continue;
    seen += 1; agree += a.sea[i] === b.sea[i] ? 1 : 0;
  }
  return seen < 40 ? 1 : agree / seen;
}
