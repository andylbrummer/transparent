#!/usr/bin/env python3
"""Synthesize a guide's narration and captions from its script (spec/guides.md §3, §9; Q1).

    python tools/guides/narrate.py tools/guides/scripts/down-through-the-earth.md

The script is Markdown: a `# <guide-id>` line, then one `## <file-stem>` section per step (the stem names the step's
files, as in `audio/<file-stem>.m4a`), and in each section one sentence per line. A line may be written
`caption text || spoken text`: the caption is what the screen shows, digits and symbols included, and the spoken text
is what the voice reads, with numbers in words so the voice cannot misread them. Lines starting `>` are notes for the
author and are not spoken.

Each sentence is spoken on its own and the pieces are joined with a short pause, so every caption cue starts and ends
with the sentence it shows: the timing is the audio's, not a guess. A sentence too long for one cue (two lines of 37
characters) is split at word boundaries, and its time is shared by the pieces in proportion to their length.

Writes, into app/public/guides/<guide-id>/audio/: <stem>.m4a (AAC-LC, mono, 64 kbit/s) and <stem>.vtt. Prints each
step's sentence start times and length, which is what a guide's cue `at` values are read from.

Needs, outside the repository (nothing here ships them):
  python -m venv ~/.cache/transparent-narration/venv
  ~/.cache/transparent-narration/venv/bin/pip install piper-tts imageio-ffmpeg
  the Piper voice en_US-ljspeech-high (.onnx and .onnx.json) from huggingface.co/rhasspy/piper-voices, in
  ~/.cache/transparent-narration/voices/ or the folder TRANSPARENT_VOICES names.
Run it with that venv's python.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GUIDES = REPO / 'app' / 'public' / 'guides'
VOICES = Path(os.environ.get('TRANSPARENT_VOICES', Path.home() / '.cache' / 'transparent-narration' / 'voices'))
VOICE = 'en_US-ljspeech-high'

# Silence before the first sentence, between sentences and after the last, in seconds. A step's audio starts with the
# view already moving, so a short lead keeps the first word from landing on the cut.
LEAD_S = 0.3
GAP_S = 0.45
TAIL_S = 0.6
# The validator's caption budget: CAPTION_MAX_LINE_CHARS in app/scripts/guide-folder.ts (37, tighter than spec §9's
# 42, so a line fits a phone held upright), and two lines a cue.
LINE_CHARS = 37
CUE_LINES = 2


@dataclass
class Sentence:
    caption: str
    spoken: str


@dataclass
class Section:
    stem: str
    sentences: list[Sentence]


def read_script(path: Path) -> tuple[str, list[Section]]:
    guide_id = None
    sections: list[Section] = []
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line or line.startswith('>'):
            continue
        if line.startswith('## '):
            sections.append(Section(line[3:].strip(), []))
        elif line.startswith('# '):
            guide_id = line[2:].strip()
        elif not sections:
            raise SystemExit(f'{path}: text before the first ## section: {line!r}')
        else:
            caption, _, spoken = line.partition(' || ')
            sections[-1].sentences.append(Sentence(caption.strip(), (spoken or caption).strip()))
    if guide_id is None or not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', guide_id):
        raise SystemExit(f'{path}: the first heading must be "# <guide-id>"')
    for section in sections:
        if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', section.stem) or not section.sentences:
            raise SystemExit(f'{path}: section {section.stem!r} needs a kebab-case name and at least one sentence')
    return guide_id, sections


def wrap(text: str) -> list[list[str]]:
    """The caption as cues of at most two lines of LINE_CHARS characters, broken at spaces."""
    lines: list[str] = []
    for word in text.split():
        if len(word) > LINE_CHARS:
            raise SystemExit(f'a word longer than a caption line: {word!r}')
        if lines and len(lines[-1]) + 1 + len(word) <= LINE_CHARS:
            lines[-1] += ' ' + word
        else:
            lines.append(word)
    return [lines[i : i + CUE_LINES] for i in range(0, len(lines), CUE_LINES)]


def synthesize(text: str, out: Path) -> None:
    model = VOICES / f'{VOICE}.onnx'
    if not model.exists():
        raise SystemExit(f'no voice at {model}: see the header of this script')
    piper = Path(sys.executable).with_name('piper')
    subprocess.run([str(piper), '-m', str(model), '-f', str(out)], input=text.encode('utf-8'), check=True, capture_output=True)


def frames(path: Path) -> tuple[bytes, int, int]:
    with wave.open(str(path), 'rb') as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit(f'{path}: expected 16-bit mono from the voice')
        return w.readframes(w.getnframes()), w.getframerate(), w.getnframes()


def timestamp(seconds: float) -> str:
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}'


def ffmpeg() -> str:
    import imageio_ffmpeg  # noqa: PLC0415 - only this script needs it, from its own venv

    return imageio_ffmpeg.get_ffmpeg_exe()


def narrate(guide_id: str, section: Section, work: Path) -> dict:
    audio_dir = GUIDES / guide_id / 'audio'
    audio_dir.mkdir(parents=True, exist_ok=True)
    pcm = bytearray()
    rate = 0
    starts: list[float] = []
    cues: list[tuple[float, float, list[str]]] = []
    for index, sentence in enumerate(section.sentences):
        wav = work / f'{section.stem}-{index}.wav'
        synthesize(sentence.spoken, wav)
        data, frame_rate, count = frames(wav)
        if rate == 0:
            rate = frame_rate
            pcm += bytes(2 * round(LEAD_S * rate))
        elif frame_rate != rate:
            raise SystemExit('the voice changed its sample rate mid-script')
        start = len(pcm) / 2 / rate
        length = count / rate
        starts.append(round(start, 2))
        pieces = wrap(sentence.caption)
        total = sum(len(' '.join(p)) for p in pieces)
        at = start
        for piece in pieces:
            share = length * len(' '.join(piece)) / total
            cues.append((at, at + share, piece))
            at += share
        pcm += data
        pcm += bytes(2 * round((GAP_S if index < len(section.sentences) - 1 else TAIL_S) * rate))

    joined = work / f'{section.stem}.wav'
    with wave.open(str(joined), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(pcm))
    m4a = audio_dir / f'{section.stem}.m4a'
    # AAC-LC, mono, 64 kbit/s: inside the validator's 96 kbit/s budget, and plenty for one voice. No metadata, so the
    # file is the same whoever runs this; faststart puts the header first, where the validator and a browser read it.
    subprocess.run(
        [ffmpeg(), '-y', '-loglevel', 'error', '-i', str(joined), '-ac', '1', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '64k',
         '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart', str(m4a)],
        check=True,
    )
    vtt = ['WEBVTT', '']
    for start, end, lines in cues:
        vtt += [f'{timestamp(start)} --> {timestamp(end)}', *lines, '']
    (audio_dir / f'{section.stem}.vtt').write_text('\n'.join(vtt), encoding='utf-8')
    duration = len(pcm) / 2 / rate
    return {'step': section.stem, 'durationS': round(duration, 2), 'sentenceStartsS': starts}


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    guide_id, sections = read_script(Path(sys.argv[1]))
    with tempfile.TemporaryDirectory() as tmp:
        report = [narrate(guide_id, section, Path(tmp)) for section in sections]
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
