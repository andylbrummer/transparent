/**
 * The guide list (spec/guides.md §4): a Guides button under Layers, and a panel of the guides index.json lists, each
 * with its title and summary. Choosing one opens its card, where Start is the tap that lets the narration play.
 *
 * The guides are fetched at the first open, not at load: most visits never open the list, and each guide is a file.
 * A guide that cannot be fetched stays in the list, saying why, so a broken guide is seen rather than silently missing.
 */

import type { Guide } from './format';

/** One guide as the list shows it: the guide, or why it could not be read. */
export type GuideListing = { readonly id: string; readonly guide: Guide } | { readonly id: string; readonly problem: string };

export interface GuideListDeps {
  readonly parent: HTMLElement;
  /** The guides, in index.json's order. Called at the first open, and again after it failed. */
  load(): Promise<readonly GuideListing[]>;
  /** Open this guide's card. The list closes first. */
  choose(id: string): void;
  /** The list has opened: whatever else shares its corner closes. */
  onOpen(): void;
}

export class GuideList {
  readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly status: HTMLParagraphElement;
  private readonly items: HTMLUListElement;
  /** null until the first open; a failed load is forgotten, so the next open tries again. */
  private loading: Promise<void> | null = null;

  constructor(private readonly deps: GuideListDeps) {
    const doc = deps.parent.ownerDocument;
    this.button = doc.createElement('button');
    this.button.type = 'button';
    this.button.id = 'guides-toggle';
    this.button.textContent = 'Guides';
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', 'guide-list');
    this.button.addEventListener('click', () => this.setOpen(this.panel.hidden));

    this.panel = doc.createElement('section');
    this.panel.id = 'guide-list';
    this.panel.className = 'guide-list';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Guides');
    const heading = doc.createElement('h2');
    heading.className = 'guide-list__heading';
    heading.textContent = 'Guides';
    this.status = doc.createElement('p');
    this.status.className = 'guide-list__status';
    this.status.setAttribute('role', 'status');
    this.items = doc.createElement('ul');
    this.items.className = 'guide-list__items';
    this.panel.append(heading, this.status, this.items);
    // Escape closes the list and gives the focus back to its button, as a menu does.
    this.panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.setOpen(false);
      this.button.focus();
    });
    deps.parent.append(this.button, this.panel);
  }

  isOpen(): boolean {
    return !this.panel.hidden;
  }

  setOpen(open: boolean): void {
    if (open === this.isOpen()) return;
    this.panel.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    this.deps.onOpen();
    this.loading ??= this.load();
  }

  dispose(): void {
    this.button.remove();
    this.panel.remove();
  }

  private async load(): Promise<void> {
    this.status.textContent = 'Loading the guides…';
    this.status.hidden = false;
    let listings: readonly GuideListing[];
    try {
      listings = await this.deps.load();
    } catch (error) {
      this.status.textContent = `The guides could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
      this.loading = null;
      return;
    }
    this.items.replaceChildren(...listings.map((listing) => this.renderItem(listing)));
    this.status.textContent = listings.length === 0 ? 'No guides yet.' : '';
    this.status.hidden = listings.length > 0;
  }

  private renderItem(listing: GuideListing): HTMLLIElement {
    const doc = this.panel.ownerDocument;
    const item = doc.createElement('li');
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'guide-list__guide';
    button.dataset.guide = listing.id;
    const title = doc.createElement('strong');
    const summary = doc.createElement('span');
    if ('guide' in listing) {
      title.textContent = listing.guide.title;
      summary.textContent = listing.guide.summary;
    } else {
      // Still pressable: the card it opens fetches the guide again and says what is wrong in full.
      title.textContent = listing.id;
      summary.textContent = listing.problem;
      button.classList.add('guide-list__guide--failed');
    }
    button.append(title, summary);
    button.addEventListener('click', () => {
      this.setOpen(false);
      this.deps.choose(listing.id);
    });
    item.appendChild(button);
    return item;
  }
}
