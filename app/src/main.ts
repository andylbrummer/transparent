/**
 * Transparent Earth — application entry point.
 *
 * Phase 1 gyro mode: the user stands at their geolocation and sees through
 * the raymarched PREM Earth wherever the phone points. Touch nudges heading
 * and zooms; without a compass, drag and keys aim. Sensor state on a HUD.
 * AR and VR attach to the same globe once a session starts.
 */

import * as THREE from 'three';
import { GlobeRenderer, BLUE_MARBLE_URL } from './render/globe';
import { OutlineLayer, type OutlineData } from './render/outlines';
import { CompassBar } from './render/compass-bar';
import { LabelLayer, type LabelData } from './render/labels';
import { SlabLayer, PlumeLayer, type SlabData, type Plume } from './render/interior';
import { QuakeLayer, type QuakeData } from './render/quakes';
import { createLookController, type LookController } from './input/look';
import { createSensorController, type SensorState } from './sensors';
import { probeCapabilities, DEFAULT_STATE, type AppState, type RenderMode } from './ui/state';
import {
  LayersPanel,
  LAYER_SWITCHES,
  LAYERS_STORAGE_KEY,
  loadLayerVisibility,
  type InteriorLayerName,
  type LayerSwitch,
} from './ui/layers-panel';

/** geology.json: labels plus the plume conduits under classified hotspots. */
interface GeologyData extends LabelData {
  readonly plumes: readonly Plume[];
}

/** Layers drawn with screen-width lines, which need the CSS viewport size. */
interface FatLineLayer {
  setResolution(widthCss: number, heightCss: number): void;
  getObject(): THREE.Object3D;
  dispose(): void;
}

export interface App {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly globe: GlobeRenderer;
  readonly look: LookController;
  getSensorState(): SensorState;
  getAppState(): AppState;
  getAvailableModes(): readonly RenderMode[];
  getFrameCount(): number;
  /** Place names placed in the last frame, for the browser harness. */
  getVisibleLabels(): string[];
  dispose(): void;
}

function formatFix(state: SensorState): string {
  switch (state.fix.phase) {
    case 'resolved':
      return `fix ±${Math.round(state.fix.accuracy)} m`;
    case 'acquiring':
      return state.fix.accuracy === null
        ? 'locating…'
        : `locating… ±${Math.round(state.fix.accuracy)} m`;
    case 'denied':
      return 'location permission denied';
    case 'unavailable':
      return 'location unavailable';
  }
}

function formatHeading(state: SensorState): string {
  if (state.heading !== null && state.declination !== null) {
    const side = state.declination >= 0 ? 'E' : 'W';
    return `heading ${state.heading.toFixed(0)}° true (declination ${Math.abs(state.declination).toFixed(1)}° ${side})`;
  }
  switch (state.headingReason) {
    case 'awaiting_position':
      return 'compass ready, waiting for location…';
    case 'device_moving':
      return 'hold still…';
    case 'high_variance':
      return 'compass interference — move away from metal';
    case 'sensor_unavailable':
      return 'no compass';
    default:
      return 'reading compass…';
  }
}

/**
 * Screen rotation and viewport as the camera uses them, so a phone test can
 * see the view follow a rotation. "angle n/a": no Screen Orientation API.
 */
function formatScreen(): string {
  const angle = screen.orientation?.angle;
  const rotation = angle === undefined ? 'angle n/a' : `${angle}°`;
  return `screen ${rotation} ${window.innerWidth}×${window.innerHeight}`;
}

export function init(): App | null {
  const container = document.getElementById('canvas-container');
  if (!container) return null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050510);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1e9
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const globe = new GlobeRenderer();
  scene.add(globe.getMesh());

  let imageryStatus: 'loading' | 'ready' | 'failed' = 'loading';
  new THREE.TextureLoader().load(
    BLUE_MARBLE_URL,
    (texture) => {
      globe.setSurfaceImagery(texture);
      imageryStatus = 'ready';
      renderHud();
    },
    undefined,
    () => {
      imageryStatus = 'failed';
      renderHud();
    }
  );

  // Everything placed on or in the Earth, hidden together until a position fix.
  const geoRoot = new THREE.Group();
  scene.add(geoRoot);
  // Political outlines, then tectonics, then plate motion arrows drawn over them.
  const outlineLayers: OutlineLayer[] = [];
  const fatLineLayers: FatLineLayer[] = [];
  const interiorObjects: Partial<Record<InteriorLayerName, THREE.Object3D>> = {};
  let quakes: QuakeLayer | null = null;
  let labels: LabelLayer | null = null;
  let geoStatus: 'loading' | 'ready' | 'failed' = 'loading';
  const layerVisibility = loadLayerVisibility(localStorage.getItem(LAYERS_STORAGE_KEY));
  function applyLayer(layer: LayerSwitch, visible: boolean): void {
    const target = layer.target;
    if ('lines' in target) {
      for (const outline of outlineLayers) outline.setLayersVisible(target.lines, visible);
    } else if ('labels' in target) {
      labels?.setKindsVisible(target.labels, visible);
    } else {
      const object = interiorObjects[target.interior];
      if (object) object.visible = visible;
    }
  }
  // Served from app/public/geo, generated by tools/pipeline/generate_geo.py
  // (outlines, labels), generate_geology.py (tectonics, geology) and
  // generate_seismicity.py (slabs, quakes) and generate_plate_motion.py.
  const geoUrl = (name: string): string => `${import.meta.env.BASE_URL}geo/${name}`;
  const fetchJson = async <T>(url: string): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  void Promise.all([
    fetchJson<OutlineData>(geoUrl('outlines.json')),
    fetchJson<OutlineData>(geoUrl('tectonics.json')),
    fetchJson<LabelData>(geoUrl('labels.json')),
    fetchJson<GeologyData>(geoUrl('geology.json')),
    fetchJson<SlabData>(geoUrl('slabs.json')),
    fetchJson<QuakeData>(geoUrl('quakes.json')),
    fetchJson<OutlineData>(geoUrl('plate-motion.json')),
  ])
    .then(([outlineData, tectonicData, placeLabels, geology, slabData, quakeData, plateMotion]) => {
      // Add order is draw order among equal render orders: surface, then interior.
      for (const data of [outlineData, tectonicData, plateMotion]) {
        const layer = new OutlineLayer(data);
        outlineLayers.push(layer);
        fatLineLayers.push(layer);
      }
      const slabs = new SlabLayer(slabData);
      const plumes = new PlumeLayer(geology.plumes);
      fatLineLayers.push(slabs, plumes);
      interiorObjects.slabs = slabs.getObject();
      interiorObjects.plumes = plumes.getObject();
      for (const layer of fatLineLayers) {
        layer.setResolution(window.innerWidth, window.innerHeight);
        geoRoot.add(layer.getObject());
      }
      quakes = new QuakeLayer(quakeData);
      quakes.setPixelRatio(renderer.getPixelRatio());
      interiorObjects.quakes = quakes.getObject();
      geoRoot.add(quakes.getObject());
      labels = new LabelLayer(container, [placeLabels, geology, quakeData]);
      for (const layer of LAYER_SWITCHES) applyLayer(layer, layerVisibility[layer.id]);
      geoStatus = 'ready';
      renderHud();
    })
    .catch((error: unknown) => {
      console.error('map data failed to load', error);
      geoStatus = 'failed';
      renderHud();
    });

  const look = createLookController();

  const hud = document.createElement('div');
  hud.id = 'hud';
  container.appendChild(hud);

  const compassBar = new CompassBar(container);

  const resetButton = document.createElement('button');
  resetButton.id = 'reset-offset';
  resetButton.type = 'button';
  resetButton.textContent = 'Reset offset';
  resetButton.title = 'Snap the view back to where the phone points';
  container.appendChild(resetButton);
  const onResetClick = (): void => look.resetOffset();
  resetButton.addEventListener('click', onResetClick);

  const layersPanel = new LayersPanel(container, layerVisibility, applyLayer, localStorage);

  const appState: AppState = DEFAULT_STATE;
  let availableModes: readonly RenderMode[] = [];
  let sensorState: SensorState = {
    position: null,
    heading: null,
    headingReason: 'insufficient_samples',
    declination: null,
    fix: { phase: 'acquiring', accuracy: null },
  };

  function renderHud(): void {
    const modes = availableModes.length > 0 ? availableModes.join('/') : 'probing…';
    const imagery = imageryStatus === 'ready' ? '' : ` · surface imagery ${imageryStatus}`;
    const geo = geoStatus === 'ready' ? '' : ` · map data ${geoStatus}`;
    hud.textContent = `${formatHeading(sensorState)} · ${formatFix(sensorState)} · ${formatScreen()} · ${appState.mode} · ${modes}${imagery}${geo}`;
  }

  const sensors = createSensorController((next) => {
    sensorState = next;
    renderHud();
  });

  const onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    for (const layer of fatLineLayers) layer.setResolution(w, h);
    renderHud();
  };
  window.addEventListener('resize', onResize);
  // A 180° turn between the two landscapes changes the angle but not the size.
  screen.orientation?.addEventListener('change', renderHud);

  // iOS only grants orientation events from inside a user gesture, so the
  // first touch asks; everywhere else this resolves without a prompt.
  let orientationPermissionAsked = false;

  // Pointer events cover mouse and touch alike; the look controller tracks
  // each pointer id, so one finger turns and two pinch.
  const onPointerDown = (e: PointerEvent): void => {
    if (!orientationPermissionAsked) {
      orientationPermissionAsked = true;
      void sensors.requestPermission();
    }
    renderer.domElement.setPointerCapture(e.pointerId);
    look.onPointerDown(e.pointerId, e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent): void =>
    look.onPointerMove(e.pointerId, e.clientX, e.clientY, renderer.domElement.clientHeight);
  const onPointerUp = (e: PointerEvent): void => look.onPointerUp(e.pointerId);
  const onKeyDown = (e: KeyboardEvent): void => look.onKeyDown(e.key);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  // A cancelled pointer (browser gesture, lost capture) ends the drag too;
  // otherwise the next touch would jump from the stale position.
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  let frameCount = 0;
  let rafId = 0;

  function animate(): void {
    rafId = requestAnimationFrame(animate);
    // No position, no view: anywhere else would show the wrong planet.
    const position = sensorState.position;
    globe.getMesh().visible = position !== null;
    geoRoot.visible = position !== null;
    labels?.setVisible(position !== null);
    compassBar.setVisible(position !== null);
    if (position) {
      look.updateCamera(camera, position, sensors.getAttitude(), screen.orientation?.angle ?? 0);
      globe.update(camera, renderer.domElement.height);
      labels?.update(camera, window.innerWidth, window.innerHeight);
      compassBar.update(camera, position, window.innerWidth);
    }
    renderer.render(scene, camera);
    frameCount++;
  }

  sensors.start();
  renderHud();
  animate();

  // Capability probing decides which session buttons are offered. It must not
  // block first paint, so the globe is already animating when this lands.
  void probeCapabilities().then((modes: RenderMode[]) => {
    availableModes = modes;
    renderHud();
  });

  return {
    scene,
    camera,
    renderer,
    globe,
    look,
    getSensorState: () => sensorState,
    getAppState: () => appState,
    getAvailableModes: () => availableModes,
    getFrameCount: () => frameCount,
    getVisibleLabels: () => labels?.visibleNames() ?? [],
    dispose() {
      cancelAnimationFrame(rafId);
      sensors.stop();
      window.removeEventListener('resize', onResize);
      screen.orientation?.removeEventListener('change', renderHud);
      window.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      for (const layer of fatLineLayers) layer.dispose();
      quakes?.dispose();
      layersPanel.dispose();
      labels?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      hud.remove();
      compassBar.dispose();
      resetButton.removeEventListener('click', onResetClick);
      resetButton.remove();
    },
  };
}

declare global {
  interface Window {
    /**
     * Instrumentation hook: lets the browser harness inspect live render and
     * sensor state without reaching into module internals.
     */
    __transparentEarth?: App;
  }
}

const app = init();
if (app) window.__transparentEarth = app;
