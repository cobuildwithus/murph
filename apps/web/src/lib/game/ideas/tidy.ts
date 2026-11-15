// Chips say "15 pushups", "20 calf raises" and "Plank 30 sec": counts first,
// no "Do", no "for". Stakes are only the words after "Winner earns" or
// "Loser has to". Only rewrites patterns that are clearly marked.
const GERUND: Record<string, string> = { meditation: 'Meditate', meditating: 'Meditate', stretching: 'Stretch', journaling: 'Journal', walking: 'Walk', running: 'Run', jogging: 'Jog', dancing: 'Dance', biking: 'Bike', cycling: 'Bike', swimming: 'Swim', dribbling: 'Dribble', rowing: 'Row' };
const countFirst = (_: string, what: string, n: string) => `${n} ${what.toLowerCase()}`;

export function tidy(text: string, isTask = true) {
  const plain = String(text)
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/\s*\([^)]*\)$/, '')
    .replace(/^(the )?winner (earns|gets|wins) /i, '')
    .replace(/^(the )?loser (has to|must|owes the winner) /i, '')
    .replace(/ of (?:your |their )?choice$/i, '')
    .replace(/(\d)K\b/g, '$1k')
    .replace(/’/g, "'");
  // Stakes finish "Loser has to ..." or "Winner earns ...", so they keep their
  // verbs ("do 100 burpees") and "for 30 min". The rest is task wording.
  if (!isTask) return plain.replace(/^./, (c) => c.toUpperCase());
  return plain
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/\s*\([^)]*\)$/, '')
    .replace(/^(before|after) (work|bed|breakfast|lunch|dinner):\s*(.+)$/i, (_, when, what, task) => `${task} ${when.toLowerCase()} ${what.toLowerCase()}`)
    .replace(/\b(\d+) (cups|glasses) water\b/i, '$1 $2 of water')
    .replace(/\bper (side|leg|arm)\b/i, 'each $1')
    .replace(/\b(\d+) minutes?\b/gi, '$1 min')
    .replace(/ of (?:your |their )?choice$/i, '')
    .replace(/^take a (\d+)[- ]min(?:ute)? (nap|walk|bath|shower)$/i, (_, n, what) => `${what} ${n} min`)
    .replace(/^(the )?winner (earns|gets|wins) /i, '')
    .replace(/^(the )?loser (has to|must|owes the winner) /i, '')
    .replace(/^([A-Za-z][A-Za-z' -]*?)\s+(\d+)\s+reps?$/i, countFirst)
    .replace(/^([A-Za-z][A-Za-z' -]*?)\s*[x×]\s?(\d+)$/i, countFirst)
    .replace(/^([A-Za-z][A-Za-z' -]*?):\s*(\d+)$/i, countFirst)
    .replace(/^([A-Za-z][A-Za-z -]*s)\s+(\d+)$/i, countFirst)
    .replace(/^([A-Za-z][A-Za-z -]*?)\s+(\d+)\s+(each (?:side|leg|arm|way))$/i, (_, what, n, each) => `${n} ${what.toLowerCase()} ${each}`)
    .replace(/^(\w+) (before|after) (bed|work|dinner|lunch|breakfast) (\d+ (?:min|pages))$/i, '$1 $4 $2 $3')
    .replace(/^(\d+)[- ]min(?:ute)?s? (?:of )?(?!(?:in|on|at|to|for|with|alone|of|outside|online)\b|(?:workout|abs)$)([a-z][a-z ]*)$/i, (_, n, what) => `${what} ${n} min`)
    .replace(/\bwith (?:my )?dog\b/i, 'with the dog')
    .replace(/^(walk|jog|run|hike|play with) dog\b/i, '$1 the dog')
    .replace(/\bmy\b/gi, 'your')
    .replace(/^(meditation|meditating|stretching|journaling|walking|running|jogging|dancing|biking|cycling|swimming|dribbling|rowing)\b/i, (w) => GERUND[w.toLowerCase()])
    .replace(/\b(brisk|easy|light|slowly|quietly|bodyweight|cozy)\s+/gi, "")
    .replace(/^do (?=\d)/i, '')
    .replace(/\bfor (?=\d+\s?(sec|secs|seconds|min|mins|minutes|hr|hrs|hours)\b)/i, '')
    .replace(/(\d)K\b/g, '$1k')
    .replace(/’/g, "'")
    .replace(/^./, (c) => c.toUpperCase());
}
