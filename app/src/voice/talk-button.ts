/**
 * The phone's push-to-talk button: held down, the microphone is open.
 * Hidden in Cardboard, where the wake word takes its place.
 */

import type { VoiceControl } from './voice-control';

export function createTalkButton(parent: HTMLElement, voice: VoiceControl): () => void {
  const button = document.createElement('button');
  button.id = 'voice-talk';
  button.type = 'button';
  button.textContent = 'Hold to talk';
  button.title = 'Hold and say a view, like "tectonics", or a layer, like "hide stars"; "help" lists the rest';
  const down = (event: PointerEvent): void => {
    event.preventDefault();
    button.classList.add('voice-talk--held');
    voice.pushStart();
    // The finger may slide off while talking: the release still comes here.
    button.setPointerCapture(event.pointerId);
  };
  const up = (): void => {
    button.classList.remove('voice-talk--held');
    voice.pushEnd();
  };
  // Space or Enter held on the focused button talks too.
  const keyDown = (event: KeyboardEvent): void => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      button.classList.add('voice-talk--held');
      voice.pushStart();
    }
  };
  const keyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ' || event.key === 'Enter') up();
  };
  // The long press would otherwise open the phone's context menu.
  const noMenu = (event: Event): void => event.preventDefault();
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('keydown', keyDown);
  button.addEventListener('keyup', keyUp);
  button.addEventListener('contextmenu', noMenu);
  parent.appendChild(button);
  return () => button.remove();
}
