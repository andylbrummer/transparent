/**
 * Shared WebXR session opening for the AR and VR controllers.
 */

/** Session factory, injectable so controllers are testable without a device. */
export type SessionFactory = () => Promise<XRSession>;

export type SessionOutcome =
  | { readonly kind: 'opened'; readonly session: XRSession }
  | { readonly kind: 'permission_denied' }
  | { readonly kind: 'unsupported' };

/**
 * Check whether the browser can run an immersive session of this mode.
 */
export async function isSessionModeSupported(mode: XRSessionMode): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported(mode);
  } catch {
    return false;
  }
}

/**
 * Open a session and report the refusals a user can act on.
 *
 * NotAllowedError (denied permission) is permission_denied and
 * NotSupportedError (a required feature missing) is unsupported; any other
 * failure propagates. `onEnd` fires when the session ends for any reason,
 * including the platform closing it (system back gesture, tab switch).
 */
export async function openSession(
  requestSession: SessionFactory,
  onEnd: (session: XRSession) => void
): Promise<SessionOutcome> {
  let session: XRSession;
  try {
    session = await requestSession();
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError') return { kind: 'permission_denied' };
    if (name === 'NotSupportedError') return { kind: 'unsupported' };
    throw error;
  }
  session.addEventListener('end', () => onEnd(session));
  return { kind: 'opened', session };
}
