import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_GUIDE } from './example-guide.testdata';
import { GuideList, type GuideListDeps, type GuideListing } from './guide-list';

let parent: HTMLElement;
let deps: { [K in keyof Omit<GuideListDeps, 'parent'>]: ReturnType<typeof vi.fn> } & { parent: HTMLElement };
let list: GuideList;

const toggle = (): HTMLButtonElement => parent.querySelector<HTMLButtonElement>('#guides-toggle')!;
const panel = (): HTMLElement => parent.querySelector<HTMLElement>('#guide-list')!;
const status = (): HTMLElement => panel().querySelector<HTMLElement>('[role="status"]')!;
const guides = (): HTMLButtonElement[] => [...panel().querySelectorAll<HTMLButtonElement>('.guide-list__guide')];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function make(load: () => Promise<readonly GuideListing[]>): void {
  parent = document.createElement('div');
  document.body.appendChild(parent);
  deps = { parent, load: vi.fn(load), choose: vi.fn(), onOpen: vi.fn() };
  list = new GuideList(deps as unknown as GuideListDeps);
}

beforeEach(() => make(() => Promise.resolve([{ id: EXAMPLE_GUIDE.id, guide: EXAMPLE_GUIDE }, { id: 'broken', problem: 'guides/broken/guide.json: HTTP 404' }])));
afterEach(() => {
  list.dispose();
  parent.remove();
});

describe('GuideList', () => {
  it('starts closed and fetches nothing until it is opened', () => {
    expect(panel().hidden).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(deps.load).not.toHaveBeenCalled();
  });

  it('lists each guide by title and summary at the first open, and one that failed with its problem', async () => {
    toggle().click();
    expect(deps.onOpen).toHaveBeenCalledOnce();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(status().textContent).toBe('Loading the guides…');
    await flush();
    expect(guides().map((b) => b.textContent)).toEqual([EXAMPLE_GUIDE.title + EXAMPLE_GUIDE.summary, 'brokenguides/broken/guide.json: HTTP 404']);
    expect(guides()[1].classList.contains('guide-list__guide--failed')).toBe(true);
    expect(status().hidden).toBe(true);
  });

  it('fetches once however often it opens', async () => {
    toggle().click();
    await flush();
    toggle().click();
    toggle().click();
    expect(deps.load).toHaveBeenCalledOnce();
  });

  it('closes and opens the card of the guide chosen', async () => {
    toggle().click();
    await flush();
    guides()[0].click();
    expect(panel().hidden).toBe(true);
    expect(deps.choose).toHaveBeenCalledWith(EXAMPLE_GUIDE.id);
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    toggle().click();
    await flush();
    guides()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
  });

  it('says when there are no guides', async () => {
    list.dispose();
    parent.remove();
    make(() => Promise.resolve([]));
    toggle().click();
    await flush();
    expect(status().textContent).toBe('No guides yet.');
    expect(guides()).toEqual([]);
  });

  it('says why the guides could not be loaded, and tries again at the next open', async () => {
    list.dispose();
    parent.remove();
    make(() => Promise.reject(new Error('guides/index.json: HTTP 404')));
    toggle().click();
    await flush();
    expect(status().textContent).toBe('The guides could not be loaded: guides/index.json: HTTP 404');
    toggle().click();
    toggle().click();
    expect(deps.load).toHaveBeenCalledTimes(2);
  });
});
