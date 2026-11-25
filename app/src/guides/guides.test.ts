import { describe, it, expect } from 'vitest';
import { guidesProblems, mediaProblems, type GuidesProblem } from '../../scripts/guide-folder';
import { APP_WORLD } from './app-world.testdata';

/** One problem a line, as CI's log shows it. */
const format = (problems: readonly GuidesProblem[]): string => problems.map(({ file, path, reason }) => `${file} ${path}: ${reason}`).join('\n');

describe('the guides the app ships', () => {
  it('every guide under app/public/guides is one the app can play', () => {
    const problems = guidesProblems('public/guides', APP_WORLD);
    expect(problems, format(problems)).toEqual([]);
  });

  it('the Stories and clips layer under app/public/media is one the app can show', () => {
    const problems = mediaProblems('public/media', APP_WORLD);
    expect(problems, format(problems)).toEqual([]);
  });
});
