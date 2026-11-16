/**
 * Drawing the Cardboard spyglass (ui/spyglass) into each eye: a disc fixed
 * on the sky over its object, the scene drawn again inside it through a
 * narrow camera, and the dwell ring while a stare fills it.
 *
 * Drawn into the eye's own viewport, not rendered to a texture and pasted:
 * three's own materials skip their sRGB conversion when they draw into a
 * render target, while this app's shaders write display values directly, so
 * a texture would hold the two in different spaces. A stencil disc masks
 * the second draw instead, as three's MaskPass does.
 *
 * The object is at infinity, so each eye sees the window where its own
 * projection puts that direction, and both see the same magnified sky in it.
 */

import * as THREE from 'three';
import { SPYGLASS_DEG } from '../ui/spyglass';

const RIM_COLOR = 0xc8d2e6;
const RIM_OPACITY = 0.55;
/** The rim's width, as a share of the window's radius. */
const RIM_WIDTH = 0.025;
/** The dwell ring's radius around the object, CSS px. */
export const FUSE_RADIUS_PX = 18;

const FUSE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A ring filling clockwise from the top: the filled part bright, the rest faint.
const FUSE_FRAGMENT_SHADER = /* glsl */ `
uniform float uFraction;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ring = smoothstep(0.62, 0.7, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float turned = atan(p.x, p.y);
  float t = (turned < 0.0 ? turned + 6.2831853 : turned) / 6.2831853;
  gl_FragColor = vec4(vec3(1.0), ring * mix(0.3, 0.95, step(t, uFraction)));
}
`;

/** A viewport rectangle, CSS px, x and y from the canvas's lower left as GL counts them. */
export interface EyeViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where world direction `direction` lands in `eye`'s view, as NDC written
 * into `out`; false when it is behind the eye. A point at infinity: the
 * eye's position and its 40 km baseline do not move it.
 */
export function projectDirection(eye: THREE.PerspectiveCamera, direction: THREE.Vector3, out: THREE.Vector2): boolean {
  const local = scratchLocal.copy(direction).transformDirection(eye.matrixWorldInverse);
  if (local.z >= 0) return false;
  const clip = scratchClip.set(local.x, local.y, local.z, 0).applyMatrix4(eye.projectionMatrix);
  out.set(clip.x / clip.w, clip.y / clip.w);
  return true;
}
const scratchLocal = new THREE.Vector3();
const scratchClip = new THREE.Vector4();

/** The window's radius in `eye`'s viewport, CSS px: SPYGLASS_DEG across, whatever the eye's field. */
export function lensRadiusPx(eye: THREE.PerspectiveCamera, viewportHeight: number): number {
  // projectionMatrix[5] is 1 / tan(half the vertical field).
  return Math.tan(THREE.MathUtils.degToRad(SPYGLASS_DEG / 2)) * eye.projectionMatrix.elements[5] * (viewportHeight / 2);
}

export class SpyglassLens {
  /** Looks at the object through the window; its field is the window's, set each draw. */
  readonly camera = new THREE.PerspectiveCamera(SPYGLASS_DEG, 1, 0.1, 1e9);
  private readonly overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly maskScene = new THREE.Scene();
  private readonly rimScene = new THREE.Scene();
  private readonly fuseScene = new THREE.Scene();
  private readonly fuseMaterial: THREE.ShaderMaterial;
  private readonly ndc = new THREE.Vector2();
  private readonly turn = new THREE.Quaternion();
  private readonly eyeForward = new THREE.Vector3();

  constructor(background: THREE.Color) {
    // Marks the disc in the stencil, and paints it the sky's background: the scene draws no background of its own here.
    const mask = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshBasicMaterial({
        color: background,
        depthTest: false,
        depthWrite: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilZPass: THREE.ReplaceStencilOp,
      })
    );
    this.maskScene.add(mask);
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(1 - RIM_WIDTH, 1, 128),
      new THREE.MeshBasicMaterial({ color: RIM_COLOR, transparent: true, opacity: RIM_OPACITY, depthTest: false, depthWrite: false })
    );
    this.rimScene.add(rim);
    this.fuseMaterial = new THREE.ShaderMaterial({
      vertexShader: FUSE_VERTEX_SHADER,
      fragmentShader: FUSE_FRAGMENT_SHADER,
      uniforms: { uFraction: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.fuseScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fuseMaterial));
  }

  /**
   * Draw the window into `eye`'s viewport: the scene through `this.camera`,
   * turned from the eye onto `direction` and `fovDeg` across, inside the
   * disc. `beforeDraw` runs first with the camera and the window's height in
   * device px, for state that follows the camera (the globe's rays).
   * Leaves the eye's viewport and scissor set as they were.
   */
  drawLens(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    eye: THREE.PerspectiveCamera,
    viewport: EyeViewport,
    direction: THREE.Vector3,
    fovDeg: number,
    beforeDraw: (camera: THREE.PerspectiveCamera, heightPx: number) => void
  ): void {
    if (!projectDirection(eye, direction, this.ndc)) return;
    const radius = lensRadiusPx(eye, viewport.height);
    // The eye's own camera turned the shortest way onto the object: the window's sky keeps the eye's roll.
    this.eyeForward.set(0, 0, -1).applyQuaternion(eye.quaternion);
    this.turn.setFromUnitVectors(this.eyeForward, direction);
    this.camera.position.copy(eye.position);
    this.camera.quaternion.copy(this.turn).multiply(eye.quaternion);
    this.camera.fov = fovDeg;
    this.camera.near = eye.near;
    this.camera.far = eye.far;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const gl = renderer.getContext();
    const stencil = renderer.state.buffers.stencil;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.useSquare(renderer, viewport, this.ndc, radius);
    renderer.clearStencil();
    renderer.render(this.maskScene, this.overlayCamera);
    renderer.clearDepth();
    beforeDraw(this.camera, Math.round(2 * radius * renderer.getPixelRatio()));
    stencil.setTest(true);
    stencil.setFunc(gl.EQUAL, 1, 0xff);
    stencil.setOp(gl.KEEP, gl.KEEP, gl.KEEP);
    // Locked, the scene's materials cannot switch the test off.
    stencil.setLocked(true);
    // A colour background clears colour, depth and stencil on every render, autoClear or not: it would wipe the disc.
    // The disc is already painted that colour.
    const sceneBackground = scene.background;
    scene.background = null;
    try {
      renderer.render(scene, this.camera);
    } finally {
      scene.background = sceneBackground;
      stencil.setLocked(false);
      stencil.setTest(false);
    }
    renderer.render(this.rimScene, this.overlayCamera);
    renderer.autoClear = autoClear;
    this.restore(renderer, viewport);
  }

  /** Draw the dwell ring, `fraction` full, round `direction` in `eye`'s viewport. */
  drawFuse(renderer: THREE.WebGLRenderer, eye: THREE.PerspectiveCamera, viewport: EyeViewport, direction: THREE.Vector3, fraction: number): void {
    if (!projectDirection(eye, direction, this.ndc)) return;
    this.fuseMaterial.uniforms.uFraction.value = fraction;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.useSquare(renderer, viewport, this.ndc, FUSE_RADIUS_PX);
    renderer.render(this.fuseScene, this.overlayCamera);
    renderer.autoClear = autoClear;
    this.restore(renderer, viewport);
  }

  dispose(): void {
    for (const scene of [this.maskScene, this.rimScene, this.fuseScene]) {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
    }
  }

  /** Viewport on the square of `radius` CSS px about NDC `centre`, cut to the eye's viewport so it never reaches the other eye. */
  private useSquare(renderer: THREE.WebGLRenderer, viewport: EyeViewport, centre: THREE.Vector2, radius: number): void {
    const cx = viewport.x + (centre.x * 0.5 + 0.5) * viewport.width;
    const cy = viewport.y + (centre.y * 0.5 + 0.5) * viewport.height;
    renderer.setViewport(cx - radius, cy - radius, 2 * radius, 2 * radius);
    const left = Math.max(viewport.x, cx - radius);
    const bottom = Math.max(viewport.y, cy - radius);
    const right = Math.min(viewport.x + viewport.width, cx + radius);
    const top = Math.min(viewport.y + viewport.height, cy + radius);
    renderer.setScissor(left, bottom, Math.max(0, right - left), Math.max(0, top - bottom));
    renderer.setScissorTest(true);
  }

  private restore(renderer: THREE.WebGLRenderer, viewport: EyeViewport): void {
    renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
  }
}
