/**
 * The AR button, and what shows over the camera while AR runs.
 *
 * The button appears only where the browser can run an immersive-ar
 * session and the app has a position fix: the room is placed at the fix,
 * so without one there is nowhere to put it.
 *
 * The overlay is the WebXR DOM-overlay root: a status line and a button to
 * leave. It is a child of <body> of its own, since the overlay root is
 * shown full screen over the camera and nothing else of the page is.
 */

export const AR_BODY_CLASS = 'ar';

export class ARControls {
  readonly overlay: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly onEnterClick = (): void => this.onEnter();
  private readonly onExitClick = (): void => this.onExit();
  // A tap on the overlay's own controls must not also reach the session as a select.
  private readonly onBeforeSelect = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.('button')) e.preventDefault();
  };

  constructor(
    parent: HTMLElement,
    private readonly onEnter: () => void,
    private readonly onExit: () => void
  ) {
    this.button = document.createElement('button');
    this.button.id = 'ar-toggle';
    this.button.type = 'button';
    this.button.textContent = 'AR';
    this.button.title = 'Open a window through the floor, using the camera';
    this.button.hidden = true;
    this.button.addEventListener('click', this.onEnterClick);
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.id = 'ar-overlay';
    this.overlay.hidden = true;
    this.status = document.createElement('p');
    this.status.className = 'ar-status';
    this.status.setAttribute('role', 'status');
    this.exitButton = document.createElement('button');
    this.exitButton.type = 'button';
    this.exitButton.className = 'ar-exit';
    this.exitButton.textContent = 'Exit AR';
    this.exitButton.addEventListener('click', this.onExitClick);
    this.overlay.append(this.status, this.exitButton);
    this.overlay.addEventListener('beforexrselect', this.onBeforeSelect);
    document.body.appendChild(this.overlay);
  }

  /** Offer the button or not. */
  setAvailable(available: boolean): void {
    this.button.hidden = !available;
  }

  /** Say on the button why AR did not start: the camera refused, or the device cannot. */
  setRefusal(text: string): void {
    this.button.textContent = text;
  }

  /** Show or hide the overlay, and mark the page as in AR. */
  setActive(active: boolean): void {
    this.overlay.hidden = !active;
    document.body.classList.toggle(AR_BODY_CLASS, active);
  }

  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  dispose(): void {
    this.button.removeEventListener('click', this.onEnterClick);
    this.exitButton.removeEventListener('click', this.onExitClick);
    this.overlay.removeEventListener('beforexrselect', this.onBeforeSelect);
    this.button.remove();
    this.overlay.remove();
    document.body.classList.remove(AR_BODY_CLASS);
  }
}
