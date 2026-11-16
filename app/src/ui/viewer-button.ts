/**
 * The Cardboard viewer's one button, which taps the screen: a tap and a
 * hold are its two commands. A tap is a press let go before HOLD_MS; a
 * hold is reported once, the moment a press reaches HOLD_MS, so the wearer
 * knows to let go. One press at a time: a second finger while one is down
 * is not the button.
 */

/** A press this long is a hold, not a tap. */
export const HOLD_MS = 800;

export class ViewerButton {
  private press: { readonly pointerId: number; readonly downMs: number; held: boolean } | null = null;

  down(pointerId: number, nowMs: number): void {
    if (!this.press) this.press = { pointerId, downMs: nowMs, held: false };
  }

  /** The press ended: true when it was a tap. */
  up(pointerId: number): boolean {
    const press = this.press;
    if (!press || press.pointerId !== pointerId) return false;
    this.press = null;
    return !press.held;
  }

  /** The browser took the press away (a system gesture): neither a tap nor a hold. */
  cancel(pointerId: number): void {
    if (this.press?.pointerId === pointerId) this.press = null;
  }

  /** Each frame: true once, when the press held reaches HOLD_MS. */
  held(nowMs: number): boolean {
    const press = this.press;
    if (!press || press.held || nowMs - press.downMs < HOLD_MS) return false;
    press.held = true;
    return true;
  }
}
