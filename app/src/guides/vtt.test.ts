import { describe, it, expect } from 'vitest';
import { captionAt, parseVtt, type CaptionCue } from './vtt';

/** A file from its lines, joined with LF. */
const vtt = (...lines: string[]): string => lines.join('\n');

describe('parseVtt reads', () => {
  it.each<[string, string, CaptionCue[]]>([
    ['the smallest file', vtt('WEBVTT', '', '00:01.000 --> 00:02.500', 'Hello'), [{ startS: 1, endS: 2.5, lines: ['Hello'] }]],
    [
      'times with and without hours',
      vtt('WEBVTT', '', '02:03.004 --> 01:02:03.004', 'a'),
      [{ startS: 123.004, endS: 3723.004, lines: ['a'] }],
    ],
    ['hours of three digits', vtt('WEBVTT', '', '99:59:59.999 --> 100:00:00.000', 'a'), [{ startS: 359999.999, endS: 360000, lines: ['a'] }]],
    ['two lines of text', vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'one', 'two'), [{ startS: 0, endS: 1, lines: ['one', 'two'] }]],
    ['a cue identifier, skipped', vtt('WEBVTT', '', 'intro', '00:00.000 --> 00:01.000', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    [
      'notes of one line and of several, between cues',
      vtt('WEBVTT', '', 'NOTE one line', '', '00:00.000 --> 00:01.000', 'a', '', 'NOTE', 'several', 'lines', '', '00:01.000 --> 00:02.000', 'b'),
      [
        { startS: 0, endS: 1, lines: ['a'] },
        { startS: 1, endS: 2, lines: ['b'] },
      ],
    ],
    ['CRLF line ends', 'WEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\na\r\nb\r\n', [{ startS: 0, endS: 1, lines: ['a', 'b'] }]],
    ['lone CR line ends', 'WEBVTT\r\r00:00.000 --> 00:01.000\ra\r', [{ startS: 0, endS: 1, lines: ['a'] }]],
    ['a byte order mark', '\uFEFF' + vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    ['text after WEBVTT', vtt('WEBVTT - narration', '', '00:00.000 --> 00:01.000', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    ['a tab after WEBVTT', vtt('WEBVTT\tnarration', '', '00:00.000 --> 00:01.000', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    [
      'several blank lines between cues, and several at the end',
      vtt('WEBVTT', '', '', '00:00.000 --> 00:01.000', 'a', '', '', '', '00:01.000 --> 00:02.000', 'b', '', '', ''),
      [
        { startS: 0, endS: 1, lines: ['a'] },
        { startS: 1, endS: 2, lines: ['b'] },
      ],
    ],
    ['no line end at the end', vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    ['the three escapes, read once', vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'R&amp;D &lt;3 &gt; &amp;lt;'), [{ startS: 0, endS: 1, lines: ['R&D <3 > &lt;'] }]],
    ['a lone >, as itself', vtt('WEBVTT', '', '00:00.000 --> 00:01.000', 'a > b'), [{ startS: 0, endS: 1, lines: ['a > b'] }]],
    ['trailing blanks after the times', vtt('WEBVTT', '', '00:00.000 --> 00:01.000 \t', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    ['a tab around the arrow', vtt('WEBVTT', '', '00:00.000\t-->\t00:01.000', 'a'), [{ startS: 0, endS: 1, lines: ['a'] }]],
    ['the WEBVTT line alone, as no cues', 'WEBVTT', []],
    ['the WEBVTT line and blank lines, as no cues', vtt('WEBVTT', '', ''), []],
    ['only notes, as no cues', vtt('WEBVTT', '', 'NOTE nothing yet'), []],
    ['a note with --> on its first line, which a player drops too', vtt('WEBVTT', '', 'NOTE a --> b'), []],
  ])('%s', (_, text, cues) => {
    expect(parseVtt(text)).toEqual(cues);
  });

  it('milliseconds exactly, summed as whole numbers before dividing', () => {
    const [first, second] = parseVtt(vtt('WEBVTT', '', '00:00:00.100 --> 00:01:00.700', 'a', '', '00:01:00.700 --> 00:20:34.567', 'b'));
    expect(first.startS).toBe(0.1);
    expect(first.endS).toBe(60.7);
    expect(second.endS).toBe(1234.567);
  });
});

describe('parseVtt refuses', () => {
  const times = '00:00.000 --> 00:01.000';
  it.each<[string, string, string]>([
    ['an empty string', '', 'not a WebVTT file: the first line is not WEBVTT'],
    ['a first line that is not WEBVTT', vtt('webvtt', '', times, 'a'), 'not a WebVTT file: the first line is not WEBVTT'],
    ['WEBVTT run on into a word', vtt('WEBVTTX', '', times, 'a'), 'not a WebVTT file: the first line is not WEBVTT'],
    ['header metadata on line 2', vtt('WEBVTT', 'Kind: captions', '', times, 'a'), 'line 2: a blank line must follow the WEBVTT line'],
    ['a STYLE block', vtt('WEBVTT', '', 'STYLE', '::cue { color: red }'), 'line 3: a STYLE block; captions are times and text only'],
    ['a REGION block', vtt('WEBVTT', '', times, 'a', '', 'REGION', 'id:top'), 'line 6: a REGION block; captions are times and text only'],
    ['a block with no times', vtt('WEBVTT', '', 'hello', 'world'), 'line 3: expected a cue\'s times, "start --> end", not "hello"'],
    ['an identifier alone', vtt('WEBVTT', '', 'intro'), 'line 3: expected a cue\'s times, "start --> end", not "intro"'],
    ['the times on the third line', vtt('WEBVTT', '', 'intro', 'more', times, 'a'), 'line 3: expected a cue\'s times, "start --> end", not "intro"'],
    [
      'no space around the arrow',
      vtt('WEBVTT', '', '00:00.000-->00:01.000', 'a'),
      'line 3: expected a cue\'s times, "start --> end", not "00:00.000-->00:01.000"',
    ],
    [
      'no space after the arrow, after an identifier',
      vtt('WEBVTT', '', 'intro', '00:00.000 -->00:01.000', 'a'),
      'line 4: expected a cue\'s times, "start --> end", not "00:00.000 -->00:01.000"',
    ],
    ['one digit of minutes', vtt('WEBVTT', '', '1:02.000 --> 1:03.000', 'a'), 'line 3: "1:02.000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    ['sixty seconds', vtt('WEBVTT', '', '00:00.000 --> 00:60.000', 'a'), 'line 3: "00:60.000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    ['sixty minutes', vtt('WEBVTT', '', '00:60:00.000 --> 01:00:00.000', 'a'), 'line 3: "00:60:00.000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    ['two digits of milliseconds', vtt('WEBVTT', '', '00:00.00 --> 00:01.000', 'a'), 'line 3: "00:00.00" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    ['a comma before the milliseconds', vtt('WEBVTT', '', '00:00,000 --> 00:01,000', 'a'), 'line 3: "00:00,000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    ['one digit of hours', vtt('WEBVTT', '', '0:00:00.000 --> 00:01.000', 'a'), 'line 3: "0:00:00.000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    ['cue settings', vtt('WEBVTT', '', `${times} align:start`, 'a'), 'line 3: cue settings are not accepted: "align:start"'],
    ['a second arrow', vtt('WEBVTT', '', `${times} --> 00:02.000`, 'a'), 'line 3: cue settings are not accepted: "--> 00:02.000"'],
    ['an end equal to the start', vtt('WEBVTT', '', '00:01.000 --> 00:01.000', 'a'), 'line 3: the cue ends at or before it starts'],
    ['an end before the start', vtt('WEBVTT', '', 'intro', '00:02.000 --> 00:01.000', 'a'), 'line 4: the cue ends at or before it starts'],
    ['a cue with no text', vtt('WEBVTT', '', times, '', 'a'), 'line 3: the cue has no text'],
    ['a cue with no text at the end', vtt('WEBVTT', '', 'intro', times), 'line 4: the cue has no text'],
    ['a line of text that is only blanks', vtt('WEBVTT', '', times, 'a', ' \t'), "line 5: a line of the cue's text is blank"],
    ['--> in the text, a missing blank line', vtt('WEBVTT', '', times, 'a', '00:01.000 --> 00:02.000', 'b'), "line 5: --> in a cue's text"],
    ['an italic tag', vtt('WEBVTT', '', times, '<i>slanted</i>'), 'line 4: a tag or a bare < in the text; captions are plain text, and < is written &lt;'],
    ['a voice tag', vtt('WEBVTT', '', times, '<v Name>Hello'), 'line 4: a tag or a bare < in the text; captions are plain text, and < is written &lt;'],
    ['a bare <', vtt('WEBVTT', '', times, 'a', '1 < 2'), 'line 5: a tag or a bare < in the text; captions are plain text, and < is written &lt;'],
    ['&nbsp;', vtt('WEBVTT', '', times, 'a&nbsp;b'), 'line 4: a bare & or an escape other than &amp; &lt; &gt; in the text; & is written &amp;'],
    ['a bare &', vtt('WEBVTT', '', times, 'R&D'), 'line 4: a bare & or an escape other than &amp; &lt; &gt; in the text; & is written &amp;'],
    ['&amp with no semicolon', vtt('WEBVTT', '', times, 'R&ampD'), 'line 4: a bare & or an escape other than &amp; &lt; &gt; in the text; & is written &amp;'],
    ['a numeric escape', vtt('WEBVTT', '', times, '&#60;'), 'line 4: a bare & or an escape other than &amp; &lt; &gt; in the text; & is written &amp;'],
    ['--> on a later line of a note', vtt('WEBVTT', '', 'NOTE', 'old cue:', times, 'a'), "line 5: --> in a note; a WebVTT player reads it as a cue's times"],
    ['--> on the second line of a note', vtt('WEBVTT', '', 'NOTE', times, 'a'), "line 4: --> in a note; a WebVTT player reads it as a cue's times"],
    ['line numbers with CRLF and a byte order mark', '\uFEFFWEBVTT\r\n\r\n00:00.000 --> 00:01.000\r\n<b>a</b>', 'line 4: a tag or a bare < in the text; captions are plain text, and < is written &lt;'],
    [
      'control characters, escaped in the message',
      vtt('WEBVTT', '', '00:00.000\u0000 --> 00:01.000', 'a'),
      'line 3: "00:00.000\\u0000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt',
    ],
    [
      'quoted text past 40 characters, cut',
      vtt('WEBVTT', '', 'x'.repeat(50), 'y'),
      `line 3: expected a cue's times, "start --> end", not "${'x'.repeat(40)}"`,
    ],
    ['U+0000 in the text', vtt('WEBVTT', '', times, 'a\u0000b'), 'line 4: a control character, U+0000, in the text'],
    ['a tab in the text', vtt('WEBVTT', '', times, 'a\tb'), 'line 4: a control character, U+0009, in the text'],
    ['hours of five digits', vtt('WEBVTT', '', '00:00.000 --> 10000:00:00.000', 'a'), 'line 3: "10000:00:00.000" is not a time; write mm:ss.ttt or hh:mm:ss.ttt'],
    [
      'controls past U+007E, escaped in the message',
      vtt('WEBVTT', '', 'x\u009b\u007f\u2028y'),
      'line 3: expected a cue\'s times, "start --> end", not "x\\u009b\\u007f\\u2028y"',
    ],
  ])('%s', (_, text, message) => {
    expect(() => parseVtt(text)).toThrow(new Error(message));
  });
});

describe('captionAt', () => {
  const cue = (startS: number, endS: number): CaptionCue => ({ startS, endS, lines: [`${startS}`] });
  // Adjoining cues, gaps, and a cue that starts where a gap ends.
  const cues = [cue(0, 1), cue(1, 2), cue(3, 4), cue(4.5, 5), cue(6, 8), cue(8, 9), cue(10, 12)];

  it('finds nothing in an empty list', () => {
    expect(captionAt([], 0)).toBeNull();
  });

  it.each<[string, number, number | null]>([
    ['before the first cue', -1, null],
    ['at the first start', 0, 0],
    ['inside the first cue', 0.5, 0],
    ['at an end where the next cue starts', 1, 1],
    ['at an end before a gap', 2, null],
    ['in a gap', 2.5, null],
    ['at a start after a gap', 3, 2],
    ['in a short gap', 4.2, null],
    ['at the fourth start', 4.5, 3],
    ['inside the fifth cue', 7, 4],
    ['at the sixth start, the fifth end', 8, 5],
    ['in the last gap', 9.5, null],
    ['just before the last end', 11.999, 6],
    ['at the last end', 12, null],
    ['after the last cue', 100, null],
  ])('%s (t = %s)', (_, tS, index) => {
    expect(captionAt(cues, tS)).toBe(index === null ? null : cues[index]);
  });
});
