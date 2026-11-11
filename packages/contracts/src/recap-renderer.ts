import type { RecapShowPage } from './recap-show.ts'

export const RECAP_PREVIEW_WIDTH = 768
export const RECAP_PREVIEW_HEIGHT = 1280
const colors = { night: '#182322', paper: '#f5f0e8', sage: '#d4dfce', sienna: '#a34f37', slate: '#384b55' }
const escape = (text: string) => text.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)

/** Deterministic authoring preview. iOS owns its native typography and gestures.
 * Pictures use meet (whole image), never slice or a destructive crop. */
export function renderRecapPageSvg(input: {
  page: RecapShowPage; treatment: string; generatedImage?: string;
  photos: ReadonlyMap<string, string>; result: readonly { name: string; score: number }[];
}): { svg: string; warnings: string[] } {
  const { page } = input
  const ink = ['night', 'sienna', 'slate'].includes(page.background) ? '#fff9ee' : '#263a32'
  const elements: string[] = []
  const warnings: string[] = []
  let y = 100
  const text = (value: string, size = 34, maxLines = 4) => {
    const width = Math.floor(660 / (size * 0.56))
    const words = value.split(/\s+/u)
    const lines: string[] = []
    for (const word of words) {
      const prior = lines.at(-1)
      if (prior && `${prior} ${word}`.length <= width) lines[lines.length - 1] = `${prior} ${word}`
      else lines.push(word)
    }
    if (lines.length > maxLines) warnings.push(`${page.id}: text needs ${lines.length} lines; shorten it.`)
    for (const line of lines) {
      elements.push(`<text x="54" y="${y}" font-family="sans-serif" font-size="${size}" fill="${ink}">${escape(line)}</text>`)
      y += Math.ceil(size * 1.3)
    }
    y += 18
  }
  const pictures = (urls: readonly string[]) => {
    if (!urls.length) { text('A moment from the game', 26); return }
    const columns = urls.length > 2 ? 3 : urls.length
    const rows = Math.ceil(urls.length / columns)
    const width = 660 / columns
    const height = Math.min(620, 1200 - y - 220) / rows
    if (height < 120) warnings.push(`${page.id}: pictures have too little room.`)
    for (const [index, url] of urls.entries()) {
      // Only host-loaded data URLs can enter an SVG renderer (no network/files).
      if (!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/u.test(url)) throw new TypeError('Preview images must be embedded verified bytes.')
      const x = 54 + (index % columns) * width
      const top = y + Math.floor(index / columns) * height
      elements.push(`<rect x="${x}" y="${top}" width="${width - 12}" height="${height - 12}" fill="#fff9ee"/><image href="${url}" x="${x + 8}" y="${top + 8}" width="${width - 28}" height="${height - 28}" preserveAspectRatio="xMidYMid meet"/>`)
    }
    y += height * rows + 28
  }
  if (page.card) { text('Most likely to', 27); text(page.card.title, 54); y += 90; text(page.card.line, 34) }
  else if (page.song) { text(page.song.title, 52); y += 90; page.song.lyrics.forEach(line => text(line, 32, 2)); text('Theme song · 20 seconds', 24) }
  else if (page.kind === 'result') { text('The result', 52); y += 70; input.result.forEach(player => text(`${player.name} · ${player.score}`, 40)); text(input.treatment, 26) }
  else {
    for (let index = 0; index <= page.blocks.length; index += 1) {
      if (page.imageIndex === index) pictures(input.generatedImage ? [input.generatedImage] : (page.fallback?.entryIds ?? []).flatMap(id => input.photos.get(id) ? [input.photos.get(id)!] : []))
      const block = page.blocks[index]
      if (!block) continue
      if (['photo', 'photoPair', 'contactSheet'].includes(block.kind)) pictures((block.entryIds ?? []).flatMap(id => input.photos.get(id) ? [input.photos.get(id)!] : []))
      else if (block.quote) text(`“${block.quote.text}” — ${block.quote.who}`, 32)
      else if (block.kind === 'stat') text([block.statValue, block.text].filter(Boolean).join(' · '), 40)
      else if (block.text) text(block.text, block.kind === 'headline' ? 48 : 27)
    }
  }
  if (y > 1220) warnings.push(`${page.id}: content extends below the page.`)
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1280" viewBox="0 0 768 1280"><rect width="768" height="1280" fill="${colors[page.background]}"/>${elements.join('')}<text x="54" y="1240" font-family="sans-serif" font-size="18" fill="${ink}">MURPH · ${escape(page.id)}</text></svg>`, warnings }
}
