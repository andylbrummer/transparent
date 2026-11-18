/**
 * WebVTT caption files, read for the caption overlay and the guide
 * validator alike, so it is pure: no Node, no DOM.
 *
 * It takes a strict subset, times and plain text, so that a file it accepts
 * shows the same words at the same times in any browser's own WebVTT
 * parser. What the overlay cannot draw (tags, styles, regions, cue
 * settings) is refused with its line, never skipped. Every pattern here is
 * linear, with no nested quantifiers: the files come from pull requests.
 */

/** One caption: the text shown from startS until endS, in seconds of the narration. */
export interface CaptionCue {
  readonly startS: number;
  readonly endS: number;
  /** The text as the author broke it, escapes read; never empty, no line of it blank. */
  readonly lines: readonly string[];
}

const HEADER = /^WEBVTT(?:$|[ \t])/;
const NOTE = /^NOTE(?:$|[ \t])/;
const UNDRAWN_BLOCK = /^(STYLE|REGION)[ \t]*$/;
const TIMES = /^(\S+)[ \t]+-->[ \t]+(\S+)(.*)$/;
const TIME = /^(?:(\d{2,4}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
const ESCAPE = /&(amp|lt|gt);/g;
const ESCAPED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>' };

const CONTROL = /\p{Cc}/u;
const hex4 = (character: string): string => character.charCodeAt(0).toString(16).padStart(4, '0');

/** File text as an error shows it: short, and with control characters escaped, so it cannot garble a log. */
const quoted = (text: string): string =>
  // JSON escapes the controls under U+0020; DEL, U+0080 to U+009F and the two line separators are left to do here.
  JSON.stringify(text.slice(0, 40)).replace(/[\p{Cc}\u2028\u2029]/gu, (character) => `\\u${hex4(character)}`);

/**
 * Read a WebVTT file's cues, in the file's order. Throws, naming the line,
 * for anything outside the subset the caption overlay draws.
 */
export function parseVtt(text: string): CaptionCue[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  if (!HEADER.test(lines[0])) throw new Error('not a WebVTT file: the first line is not WEBVTT');
  // Header metadata lines are not accepted: nothing of them would be drawn.
  if (lines.length > 1 && lines[1] !== '') throw new Error('line 2: a blank line must follow the WEBVTT line');

  const cues: CaptionCue[] = [];
  let i = 2;
  while (i < lines.length) {
    if (lines[i] === '') {
      i++;
      continue;
    }
    // A block: the lines from `first` up to the next empty one.
    const first = i;
    while (i < lines.length && lines[i] !== '') i++;
    const cue = readBlock(lines, first, i);
    if (cue) cues.push(cue);
  }
  return cues;
}

/** One block: a note (undefined) or a cue. Line numbers in errors count from 1. */
function readBlock(lines: readonly string[], first: number, end: number): CaptionCue | undefined {
  const head = lines[first];
  if (NOTE.test(head)) {
    // A WebVTT player ends a note at a line holding -->, and reads that line as a cue's times.
    // Skipping the whole block would drop that cue silently.
    for (let k = first + 1; k < end; k++) {
      if (lines[k].includes('-->')) throw new Error(`line ${k + 1}: --> in a note; a WebVTT player reads it as a cue's times`);
    }
    return undefined;
  }
  const undrawn = UNDRAWN_BLOCK.exec(head);
  if (undrawn) throw new Error(`line ${first + 1}: a ${undrawn[1]} block; captions are times and text only`);

  // The times are on the first line, or on the second after an identifier, which the overlay has no use for.
  let timing = first;
  if (!head.includes('-->')) {
    if (first + 1 < end && lines[first + 1].includes('-->')) timing = first + 1;
    else throw new Error(`line ${first + 1}: expected a cue's times, "start --> end", not ${quoted(head)}`);
  }
  const n = timing + 1;
  const times = TIMES.exec(lines[timing]);
  if (!times) throw new Error(`line ${n}: expected a cue's times, "start --> end", not ${quoted(lines[timing])}`);
  const settings = times[3].trim();
  if (settings !== '') throw new Error(`line ${n}: cue settings are not accepted: ${quoted(settings)}`);
  const startS = seconds(times[1], n);
  const endS = seconds(times[2], n);
  if (endS <= startS) throw new Error(`line ${n}: the cue ends at or before it starts`);

  const text = lines.slice(timing + 1, end);
  if (text.length === 0) throw new Error(`line ${n}: the cue has no text`);
  text.forEach((line, k) => checkText(line, timing + 2 + k));
  return { startS, endS, lines: text.map((line) => line.replace(ESCAPE, (_, name: string) => ESCAPED[name])) };
}

/** A timestamp in seconds, summed in whole milliseconds first so that 00:00:00.100 is exactly 0.1. */
function seconds(time: string, n: number): number {
  const parts = TIME.exec(time);
  if (!parts) throw new Error(`line ${n}: ${quoted(time)} is not a time; write mm:ss.ttt or hh:mm:ss.ttt`);
  const [, hours = '0', minutes, secs, millis] = parts;
  return (((Number(hours) * 60 + Number(minutes)) * 60 + Number(secs)) * 1000 + Number(millis)) / 1000;
}

/** A line of a cue's text: plain text, with only the three escapes a WebVTT parser and the overlay read alike. */
function checkText(line: string, n: number): void {
  if (line.trim() === '') throw new Error(`line ${n}: a line of the cue's text is blank`);
  // A WebVTT player shows U+0000 as U+FFFD, and no control character is a word of a caption.
  const control = CONTROL.exec(line);
  if (control) throw new Error(`line ${n}: a control character, U+${hex4(control[0]).toUpperCase()}, in the text`);
  // Most likely a missing blank line before the next cue.
  if (line.includes('-->')) throw new Error(`line ${n}: --> in a cue's text`);
  if (line.includes('<')) throw new Error(`line ${n}: a tag or a bare < in the text; captions are plain text, and < is written &lt;`);
  if (line.replace(ESCAPE, '').includes('&')) {
    throw new Error(`line ${n}: a bare & or an escape other than &amp; &lt; &gt; in the text; & is written &amp;`);
  }
}

/**
 * The cue showing at tS, start included and end not; null in a gap. `cues`
 * must be in order and not overlap, which the guide validator checks
 * (spec/guides.md §9): a list that is not gives a wrong answer, not an error.
 */
export function captionAt(cues: readonly CaptionCue[], tS: number): CaptionCue | null {
  // The last cue starting at or before tS, by halving.
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cues[mid].startS <= tS) low = mid + 1;
    else high = mid;
  }
  const cue = cues[low - 1];
  return cue !== undefined && tS < cue.endS ? cue : null;
}
