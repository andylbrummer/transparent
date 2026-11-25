/**
 * Transparent Earth — application entry point.
 *
 * Phase 1 gyro mode: the user stands at their geolocation and sees through
 * the raymarched PREM Earth wherever the phone points. Touch nudges heading
 * and zooms; without a compass, drag and keys aim. Sensor state on a HUD.
 * AR and VR attach to the same globe once a session starts.
 */

import * as THREE from 'three';
import { GlobeRenderer, BLUE_MARBLE_TILES, BLUE_MARBLE_WIDTH } from './render/globe';
import { composeGlobe } from './layers/weather/gibs-tiles';
import { OutlineLayer, type OutlineData } from './render/outlines';
import { CompassBar } from './render/compass-bar';
import { LabelLayer, type LabelData } from './render/labels';
import { PlumeLayer, type Plume } from './render/interior';
import { QuakeLayer, type QuakeData } from './render/quakes';
import { StereoRig } from './render/stereo';
import { Dip } from './render/dip';
import { icrsToEcefMatrix } from '@transparent-earth/core';
import { createLookController, type LookController } from './input/look';
import { createSensorController, FALLBACK_PLACE, type SensorState } from './sensors';
import {
  probeCapabilities,
  surfaceImageryNote,
  wantsMultisampling,
  DEFAULT_STATE,
  type AppState,
  type ImageryStatus,
  type RenderMode,
} from './ui/state';
import {
  LayersPanel,
  LAYER_SWITCHES,
  LAYERS_STORAGE_KEY,
  SECTIONS_STORAGE_KEY,
  loadLayerVisibility,
  loadOpenSections,
  switchesWithLazyLayers,
  type InteriorLayerName,
  type LayerSwitch,
} from './ui/layers-panel';
import { CardboardToggle } from './ui/cardboard';
import { CAPTURE_DEG, SPYGLASS_DEG, Spyglass, type SpyglassState } from './ui/spyglass';
import { SpyglassLens, lensRadiusPx } from './render/spyglass-lens';
import { HeadGestures, type HeadGesture } from './input/head-gestures';
import { ViewerButton } from './ui/viewer-button';
import { CardboardCalibration, headRollRad } from './ui/cardboard-calibration';
import { LAYER_PRESETS, defaultPreset } from './ui/presets';
import { ARControls } from './ui/ar-controls';
import { ARRunner } from './xr/ar/runner';
import { headingAxis, headingOfXrForward, xrYawDeg } from './xr/ar/frame';
import { allCredits } from './ui/credits';
import { createClock } from './clock';
import { reloadIfRedeployed, type BuildCheck } from './build-check';
import { VoiceControl, cancelBrowserSpeech, createBrowserRecognizer, speakWithBrowser } from './voice/voice-control';
import { VoiceOverlay } from './voice/voice-overlay';
import { createTalkButton } from './voice/talk-button';
import { IDENTIFY_MAX_ANGLE_RAD, VOICE_ZOOM_FACTOR, respondToSpeech } from './voice/respond';
import { findTitle } from './voice/commands';
import { LAYER_DEFINITIONS } from './layers/registry';
import { LayerManager } from './layers/manager';
import type { ViewControl } from './view/actions';
import { GazePointer, type StereoEyes } from './view/gaze-pointer';
import { CaptionOverlay } from './guides/captions';
import { StereoNotice } from './guides/stereo-notice';
import { PauseCard } from './guides/pause-card';
import { fetchGuides, guideLink } from './guides/guide-files';
import { GuideList, type GuideListing } from './guides/guide-list';
import { createGuideSession, type GuideStatus } from './guides/guide-session';
import { createViewControl } from './view/view-control';
import { indexLabels, type LabelIndex } from './view/targets';
import { createStandingPlace } from './view/standing-place';
import { SKY_RADIUS_M, type SkyUniforms, type SpyglassFrame } from './layers/types';
import { WHOLE_SKY_BRIGHTNESS } from './layers/sky-below-horizon/layer';

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

/** A field keeps every key while it has the focus: a guide's key typed there is the field's. */
const FIELDS = 'input, select, textarea';
/** A button or a link keeps only the keys that press it: Space on a button already clicks it. */
const PRESSABLE = 'button, a';

export interface App {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly globe: GlobeRenderer;
  readonly look: LookController;
  /** The view's actions, for the browser harness: perform a look or a mark by hand. */
  readonly viewControl: ViewControl;
  getSensorState(): SensorState;
  getAppState(): AppState;
  getAvailableModes(): readonly RenderMode[];
  getFrameCount(): number;
  /** Place names placed in the last frame, for the browser harness. */
  getVisibleLabels(): string[];
  /** The app clock's current instant. */
  getDate(): Date;
  /** The guide's card and player, for the browser harness. */
  getGuide(): GuideStatus;
  /** The Cardboard spyglass's state and window, for the browser harness. */
  getSpyglass(): {
    readonly state: SpyglassState['kind'];
    readonly target: string | null;
    readonly fovDeg: number | null;
    /** The last nod or shake seen in the viewer. */
    readonly lastHeadGesture: HeadGesture | null;
  };
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
      return state.fallback ? `location permission denied, showing ${FALLBACK_PLACE}` : 'location permission denied';
    case 'unavailable':
      return state.fallback ? `location unavailable, showing ${FALLBACK_PLACE}` : 'location unavailable';
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
  const background = new THREE.Color(0x050510);
  scene.background = background;

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1e9
  );

  // A stencil buffer for AR, where the portal masks every layer to the window in the floor.
  const renderer = new THREE.WebGLRenderer({ antialias: wantsMultisampling(window.devicePixelRatio), stencil: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const globe = new GlobeRenderer();
  scene.add(globe.getMesh());

  let imageryStatus: ImageryStatus = 'loading';
  // What the HUD last said about it, to say so again when another map takes over or goes.
  let imageryShown = false;
  // The baked 2048-wide copy first (tools/pipeline/generate_base_map.py): it is local and there at
  // once, so the planet is never one flat colour while the sharper live map is on its way, or if it
  // never comes. The HUD says "offline copy" only once the live map has actually failed.
  const imageryLoader = new THREE.TextureLoader();
  let standIn: THREE.Texture | null = null;
  imageryLoader.load(
    `${import.meta.env.BASE_URL}geo/blue-marble.jpg`,
    (texture) => {
      if (imageryStatus === 'ready') {
        texture.dispose();
        return;
      }
      standIn = texture;
      globe.setSurfaceImagery(texture);
      if (imageryStatus === 'failed') imageryStatus = 'offline';
      renderHud();
    }
  );
  const loadLiveImagery = (): void => {
    composeGlobe(BLUE_MARBLE_TILES, null, BLUE_MARBLE_WIDTH).then(
      (canvas) => {
        globe.setSurfaceImagery(new THREE.CanvasTexture(canvas));
        standIn?.dispose();
        standIn = null;
        imageryStatus = 'ready';
        renderHud();
      },
      () => {
        imageryStatus = standIn ? 'offline' : 'failed';
        renderHud();
      }
    );
  };
  // After the page's own load: a slow imagery server must not hold that up.
  if (document.readyState === 'complete') loadLiveImagery();
  else window.addEventListener('load', loadLiveImagery, { once: true });

  // Everything placed on or in the Earth, hidden together until a position fix.
  const geoRoot = new THREE.Group();
  scene.add(geoRoot);
  // The sky: both turn with the stars, about the Earth's centre and about the camera.
  const inertialRoot = new THREE.Group();
  const skyRoot = new THREE.Group();
  skyRoot.scale.setScalar(SKY_RADIUS_M);
  scene.add(inertialRoot, skyRoot);
  const skyRotation = new THREE.Matrix4();
  const skyUniforms: SkyUniforms = {
    uObserverUp: { value: new THREE.Vector3(0, 0, 1) },
    // Off until the "Sky through the Earth" layer turns it on.
    uBelowHorizon: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  };
  const clock = createClock(window.location.search);
  // Political outlines, then tectonics drawn over them.
  const outlineLayers: OutlineLayer[] = [];
  const fatLineLayers: FatLineLayer[] = [];
  const interiorObjects: Partial<Record<InteriorLayerName, THREE.Object3D>> = {};
  let quakes: QuakeLayer | null = null;
  const labels = new LabelLayer(container, []);
  // Over the canvas and the names, under everything that stands over them: so made before those.
  const dip = new Dip(container, `#${background.getHexString()}`);
  // The baked labels by name, for a guide's label targets; null until the map data has loaded.
  let labelIndex: LabelIndex | null = null;
  let geoStatus: 'loading' | 'ready' | 'failed' = 'loading';
  const layerSwitches = switchesWithLazyLayers(LAYER_DEFINITIONS);
  const layerVisibility = loadLayerVisibility(localStorage.getItem(LAYERS_STORAGE_KEY), layerSwitches);
  function applyLayer(layer: LayerSwitch, visible: boolean): void {
    const target = layer.target;
    if ('lines' in target) {
      for (const outline of outlineLayers) outline.setLayersVisible(target.lines, visible);
    } else if ('labels' in target) {
      labels.setKindsVisible(target.labels, visible);
    } else if ('lazy' in target) {
      lazyLayers.setVisible(target.lazy, visible);
    } else if ('shell' in target) {
      globe.setShellVisible(target.shell, visible);
    } else {
      const object = interiorObjects[target.interior];
      if (object) object.visible = visible;
    }
  }
  // Served from app/public/geo, generated by tools/pipeline/generate_geo.py
  // (outlines, labels), generate_geology.py (tectonics, geology) and
  // generate_seismicity.py (quakes).
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
    fetchJson<QuakeData>(geoUrl('quakes.json')),
  ])
    .then(([outlineData, tectonicData, placeLabels, geology, quakeData]) => {
      // Add order is draw order among equal render orders: surface, then interior.
      for (const data of [outlineData, tectonicData]) {
        const layer = new OutlineLayer(data);
        outlineLayers.push(layer);
        fatLineLayers.push(layer);
      }
      const plumes = new PlumeLayer(geology.plumes);
      fatLineLayers.push(plumes);
      interiorObjects.plumes = plumes.getObject();
      for (const layer of fatLineLayers) {
        layer.setResolution(window.innerWidth, window.innerHeight);
        geoRoot.add(layer.getObject());
      }
      quakes = new QuakeLayer(quakeData);
      quakes.setPixelRatio(renderer.getPixelRatio());
      interiorObjects.quakes = quakes.getObject();
      geoRoot.add(quakes.getObject());
      labels.addLabels([placeLabels, geology, quakeData]);
      labelIndex = indexLabels([placeLabels, geology, quakeData]);
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
  const gazePointer = new GazePointer(container);
  const captions = new CaptionOverlay(container);
  const stereoNotice = new StereoNotice(container);
  const pauseCard = new PauseCard(container);

  const resetButton = document.createElement('button');
  resetButton.id = 'reset-offset';
  resetButton.type = 'button';
  resetButton.textContent = 'Reset offset';
  resetButton.title = 'Snap the view back to where the phone points';
  container.appendChild(resetButton);
  const onResetClick = (): void => look.resetOffset();
  resetButton.addEventListener('click', onResetClick);

  const presets = [defaultPreset(layerSwitches), ...LAYER_PRESETS];
  // The guide list and the credits both read every guide: fetched once, by whichever asks first, and again after a failure.
  let guides: Promise<GuideListing[]> | null = null;
  const loadGuides = (): Promise<GuideListing[]> => {
    guides ??= fetchGuides({ fetch: (url) => fetch(url), baseUrl: import.meta.env.BASE_URL }).catch((error: unknown) => {
      guides = null;
      throw error;
    });
    return guides;
  };
  const layersPanel = new LayersPanel(container, layerVisibility, applyLayer, localStorage, {
    switches: layerSwitches,
    credits: allCredits(LAYER_DEFINITIONS),
    guideCredits: () => loadGuides().then((listings) => listings.flatMap((l) => ('guide' in l ? [{ title: l.guide.title, credits: l.guide.credits }] : []))),
    openSections: loadOpenSections(localStorage.getItem(SECTIONS_STORAGE_KEY)),
    presets,
  });

  const appState: AppState = DEFAULT_STATE;
  let availableModes: readonly RenderMode[] = [];
  let sensorState: SensorState = {
    position: null,
    heading: null,
    headingReason: 'insufficient_samples',
    declination: null,
    fix: { phase: 'acquiring', accuracy: null },
    fallback: false,
  };
  // Where the view stands: the fix, or a place an action set. AR keeps the fix, since its window opens onto the real ground.
  const standing = createStandingPlace(() => sensorState.position);

  // A layer that fails may be code from a build the site no longer serves; one check covers a burst of failures.
  let buildCheck: Promise<BuildCheck> | null = null;
  function checkBuildAfterLoadFailure(): void {
    if (buildCheck) return;
    buildCheck = reloadIfRedeployed({
      runningEntryUrl: import.meta.url,
      pageUrl: new URL(import.meta.env.BASE_URL, window.location.href).href,
      fetchPage: async (url) => {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.text();
      },
      storage: localStorage,
      reload: () => window.location.reload(),
    });
    buildCheck
      .then((result) => {
        if (result === 'stale-after-reload') console.error('build check: reloaded for the new build, but the browser still runs the old one');
      })
      .catch((error: unknown) => console.error('build check failed', error))
      .finally(() => {
        buildCheck = null;
      });
  }
  const lazyLayers = new LayerManager(
    LAYER_DEFINITIONS,
    {
      renderer,
      earthRoot: geoRoot,
      inertialRoot,
      skyRoot,
      skyUniforms,
      globe,
      assetUrl: (path) => `${import.meta.env.BASE_URL}${path}`,
      fetchJson: async <T>(url: string, init?: RequestInit): Promise<T> => {
        const response = await fetch(url, init);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return (await response.json()) as T;
      },
      now: () => clock.now(),
      getPosition: () => standing.position(),
      addLabels: (spec) => labels.addGroup(spec),
    },
    (id, text, tone) => layersPanel.setStatus(id, text, tone),
    checkBuildAfterLoadFailure
  );
  const viewControl = createViewControl({
    presets,
    switches: layerSwitches,
    layersPanel,
    lazyLayers,
    shells: globe,
    camera,
    standing,
    clock,
    getLabels: () => labelIndex,
    loadedLabels: labels,
    look,
    getAttitude: () => sensors.getAttitude(),
    // Read on every action: the user can change it while the app is open.
    prefersReducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    addLabels: (spec) => labels.addGroup(spec),
    // Read at frame time, by when both exist.
    spyglass: { inStereo: () => cardboard.isActive() && !arRunner.isActive(), openOn: (target) => spyglass.openOn(target) },
    dip: (change) => dip.run(change),
  });
  const guideSession = createGuideSession({
    parent: container,
    view: viewControl,
    audio: new Audio(),
    fetch: (url, init) => fetch(url, init),
    baseUrl: import.meta.env.BASE_URL,
    objectUrl: { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) },
    captions,
    labels: () => geoStatus,
    storage: localStorage,
  });
  // The list shares the top-left corner with the layers panel: one open closes the other.
  const guideList = new GuideList({
    parent: container,
    load: loadGuides,
    choose: (id) => guideSession.open({ id, at: null }),
    onOpen: () => layersPanel.setOpen(false),
  });
  const closeGuideList = (): void => guideList.setOpen(false);
  document.getElementById('layers-toggle')?.addEventListener('click', closeGuideList);
  // A link opens the guide's card; one that cannot be read opens it too, to say why.
  const link = guideLink(window.location.search);
  if (link) guideSession.open(link);
  // Hiding the page pauses the guide, and coming back does not resume it: the user says when the voice goes on.
  const onVisibilityChange = (): void => {
    if (document.hidden) guideSession.pause();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  for (const layer of layerSwitches) {
    if ('lazy' in layer.target && layerVisibility[layer.id]) applyLayer(layer, true);
    // The globe is there from the start, without waiting on the map data.
    if ('shell' in layer.target) applyLayer(layer, layerVisibility[layer.id]);
  }

  // Placed rooms need a position: the window opens onto the ground under the fix.
  const arAim = new THREE.PerspectiveCamera();
  const arControls = new ARControls(
    container,
    () => void arRunner.start().catch(() => arControls.setRefusal('AR failed to start')),
    () => void arRunner.stop()
  );
  const arRunner = new ARRunner({
    renderer,
    scene,
    controls: arControls,
    getPosition: () => sensorState.position,
    headingOfXrForward: (xrQuaternion, position) => {
      const attitude = sensors.getAttitude();
      if (attitude) {
        // The phone as the compass sees it, aimed as the ordinary view aims it, nudge included.
        look.updateCamera(arAim, position, attitude, screen.orientation?.angle ?? 0);
        return headingOfXrForward(xrQuaternion, arAim.quaternion, position.lat, position.lon);
      }
      if (sensorState.heading === null) return null;
      // A heading alone: take it as that of the axis the phone is aimed along.
      const axis = headingAxis(xrQuaternion).applyQuaternion(xrQuaternion);
      return (((sensorState.heading - xrYawDeg(axis)) % 360) + 360) % 360;
    },
    onChange: (active) => {
      if (active && cardboard.isActive()) cardboard.exit();
      layersPanel.setOpen(false);
      guideList.setOpen(false);
      // Back from AR: the ordinary camera and canvas size again.
      if (!active) onResize();
    },
  });

  function renderHud(): void {
    arControls.setAvailable(availableModes.includes('ar') && sensorState.position !== null);
    const modes = availableModes.length > 0 ? availableModes.join('/') : 'probing…';
    imageryShown = globe.hasSurfaceImagery();
    const imagery = surfaceImageryNote(imageryStatus, imageryShown);
    const geo = geoStatus === 'ready' ? '' : ` · map data ${geoStatus}`;
    // Read after leaving Cardboard: inside it the HUD is hidden.
    const wakeLockProblem = cardboard.getWakeLockProblem();
    const awake = wakeLockProblem ? ` · screen wake lock refused (${wakeLockProblem})` : '';
    hud.textContent = `${formatHeading(sensorState)} · ${formatFix(sensorState)} · ${formatScreen()} · ${appState.mode} · ${modes}${imagery}${geo}${awake}`;
  }

  const sensors = createSensorController((next) => {
    sensorState = next;
    renderHud();
  });

  const onResize = (): void => {
    // The XR session owns the framebuffer while it presents.
    if (renderer.xr.isPresenting) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    // Line widths are CSS px of the viewport they draw into: one eye's in stereo.
    const lineWidth = cardboard.isActive() ? Math.floor(w / 2) : w;
    for (const layer of fatLineLayers) layer.setResolution(lineWidth, h);
    lazyLayers.setResolution(lineWidth, h);
    renderHud();
  };
  window.addEventListener('resize', onResize);
  // A 180° turn between the two landscapes changes the angle but not the size.
  screen.orientation?.addEventListener('change', renderHud);

  // iOS only grants orientation events from inside a user gesture, so the
  // first touch asks; everywhere else this resolves without a prompt.
  let orientationPermissionAsked = false;
  const viewerButton = new ViewerButton();

  // Pointer events cover mouse and touch alike; the look controller tracks
  // each pointer id, so one finger turns and two pinch.
  const onPointerDown = (e: PointerEvent): void => {
    // In the viewer the only input is its button, which taps the screen: it keeps the calibration, or is
    // read as a tap (into the spyglass) or a hold (leave) - see onPointerUp and the frame loop.
    if (cardboard.isActive()) {
      if (cardboard.isCalibrating()) {
        cardboardCalibration.save();
        cardboard.finishCalibration();
      } else {
        renderer.domElement.setPointerCapture(e.pointerId);
        viewerButton.down(e.pointerId, performance.now());
      }
      return;
    }
    if (!orientationPermissionAsked) {
      orientationPermissionAsked = true;
      void sensors.requestPermission();
    }
    renderer.domElement.setPointerCapture(e.pointerId);
    look.onPointerDown(e.pointerId, e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent): void =>
    look.onPointerMove(e.pointerId, e.clientX, e.clientY, renderer.domElement.clientHeight);
  const onPointerUp = (e: PointerEvent): void => {
    // Always let the button go: a hold that left the viewer ends here, outside it.
    const tapped = viewerButton.up(e.pointerId);
    if (cardboard.isActive()) {
      if (tapped && !cardboard.isCalibrating()) {
        // The spyglass has first call on the button; with nothing for it under the gaze, the guide takes it.
        const candidate = labels.skyTargetNearViewCenter(camera, THREE.MathUtils.degToRad(CAPTURE_DEG));
        if (spyglass.claims(candidate) || !guideSession.onViewerInput('tap')) spyglass.deeper(candidate);
      }
      return;
    }
    look.onPointerUp(e.pointerId);
  };
  const onPointerCancel = (e: PointerEvent): void => {
    viewerButton.cancel(e.pointerId);
    look.onPointerUp(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    // In the viewer the zoom keys are the spyglass's; turning keys stay the look's.
    if (cardboard.isActive() && !cardboard.isCalibrating()) {
      const candidate = labels.skyTargetNearViewCenter(camera, THREE.MathUtils.degToRad(CAPTURE_DEG));
      if (spyglass.onKeyDown(e.key, candidate)) {
        e.preventDefault();
        return;
      }
    }
    // A guide's key is one press, not one held down, and with Ctrl, Cmd or Alt it is the browser's shortcut, not the
    // guide's. A focused field keeps every key, and a focused button the keys that press it: taking Space here too
    // would do two things at once. Escape is no button's, so it still closes the transcript and then leaves with the
    // focus on the Text button. Taken, Space does not scroll the page.
    const focused = e.target instanceof Element ? e.target : null;
    const focusKeeps = focused !== null && (focused.matches(FIELDS) || (focused.matches(PRESSABLE) && (e.key === ' ' || e.key === 'Enter')));
    const guideKey = !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !focusKeeps;
    if (guideKey && guideSession.onKey(e.key)) {
      e.preventDefault();
      return;
    }
    look.onKeyDown(e.key);
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  // A cancelled pointer (browser gesture, lost capture) ends the drag too;
  // otherwise the next touch would jump from the stale position.
  renderer.domElement.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);

  const stereoRig = new StereoRig();
  /** The eyes the gaze pointer draws through in Cardboard: one object for every frame. */
  const pointerEyes: StereoEyes = { left: stereoRig.left, right: stereoRig.right, eyeWidth: 0 };
  // Hands-free zoom in the viewer: a stare at a name in the sky opens a magnified window over it; nods and shakes steer it.
  const spyglass = new Spyglass();
  const headGestures = new HeadGestures();
  const headOrientation = new THREE.Quaternion();
  let lastHeadGesture: HeadGesture | null = null;
  const spyglassLens = new SpyglassLens(background);
  const headForward = new THREE.Vector3();
  const spyglassDirection = new THREE.Vector3();
  const cardboardCalibration = new CardboardCalibration(container, localStorage);
  const cardboard = new CardboardToggle(container, (stereo) => {
    // Entering is a tap on the button, so iOS can still be asked for the compass here.
    if (stereo && !orientationPermissionAsked) {
      orientationPermissionAsked = true;
      void sensors.requestPermission();
    }
    layersPanel.setOpen(false);
    guideList.setOpen(false);
    labels.setStereo(stereo);
    spyglass.reset();
    headGestures.reset();
    labels.setSpyglassHole(null);
    // Nothing can be pressed in the viewer: the microphone stays open for the wake word.
    voice.setWakeListening(stereo);
    onResize();
  });

  const voiceOverlay = new VoiceOverlay(container);
  const voice = new VoiceControl({
    createRecognizer: createBrowserRecognizer,
    speak: (text) => speakWithBrowser(text, navigator.language),
    cancelSpeech: cancelBrowserSpeech,
    lang: navigator.language,
    onStatus: (status) => voiceOverlay.show(status),
    respond: (alternatives) =>
      respondToSpeech(alternatives, {
        vocabulary: { presets, switches: layerSwitches },
        viewControl,
        nameInView: () => labels.nameNearestViewCenter(camera, IDENTIFY_MAX_ANGLE_RAD),
        isInCardboard: () => cardboard.isActive(),
        isCalibrating: () => cardboard.isCalibrating(),
        calibrate: () => {
          // Fullscreen needs a tap, so a spoken entry may stay windowed (enter reports it).
          if (cardboard.isActive()) cardboard.beginCalibration();
          else void cardboard.enter(true);
        },
        keepCalibration: () => {
          cardboardCalibration.save();
          cardboard.finishCalibration();
        },
        exitCardboard: () => cardboard.exit(),
        resetView: () => look.resetOffset(),
        guide: {
          isOpen: () => guideSession.getGuide().state !== 'idle',
          isNarrating: () => guideSession.isNarrating(),
          perform: (action) => guideSession.onVoice(action),
          play: (title) => {
            loadGuides().then(
              (listings) => {
                const found = listings.flatMap((l) => ('guide' in l ? [l.guide] : []));
                const index = findTitle(title, found.map((g) => g.title));
                if (index < 0) voice.say(`No guide called "${title}".`);
                else guideSession.play(found[index].id);
              },
              () => voice.say('The guides could not be loaded.')
            );
            return `Finding the guide "${title}".`;
          },
        },
        zoom: (inward) => {
          if (!cardboard.isActive()) {
            look.zoomIn(inward ? VOICE_ZOOM_FACTOR : 1 / VOICE_ZOOM_FACTOR);
            return { done: true, on: null };
          }
          // In the viewer, as a nod and a shake: open the spyglass or go a level deeper; back a level, or close it.
          if (inward) {
            spyglass.deeper(labels.skyTargetNearViewCenter(camera, THREE.MathUtils.degToRad(CAPTURE_DEG)));
            const now = spyglass.getState();
            return now.kind === 'open' ? { done: true, on: now.target.name } : { done: false };
          }
          if (spyglass.getState().kind !== 'open') return { done: false };
          spyglass.back();
          const now = spyglass.getState();
          return { done: true, on: now.kind === 'open' ? now.target.name : null };
        },
      }),
  });
  const removeTalkButton = voice.isSupported() ? createTalkButton(container, voice) : () => undefined;
  lazyLayers.setResolution(window.innerWidth, window.innerHeight);

  let frameCount = 0;
  let lastFrameMs = performance.now();

  // The renderer's loop, not window rAF: the window stops its frames while an XR session presents.
  function animate(_time: number, frame?: XRFrame): void {
    const ar = arRunner.isActive();
    // No position, no view. Without a fix the sensors stand in at FALLBACK_POSITION, and the HUD says so. In AR, nothing until the window is open.
    const position = ar ? sensorState.position : standing.position();
    const showEarth = position !== null && (!ar || arRunner.isPlaced());
    globe.getMesh().visible = showEarth;
    geoRoot.visible = showEarth;
    inertialRoot.visible = showEarth;
    skyRoot.visible = showEarth;
    labels.setVisible(position !== null && !ar);
    compassBar.setVisible(position !== null && !ar);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const stereo = !ar && position !== null && cardboard.isActive();
    // AR draws no pointer and no captions; arrival is still counted there.
    gazePointer.setVisible(position !== null && !ar);
    // The pause card stands where the captions would: paused, there is nothing being said to caption.
    captions.setVisible(position !== null && !ar && !(stereo && pauseCard.isOpen()));
    captions.place(stereo, width, height, cardboardCalibration.spacingPx());
    stereoNotice.show(stereo ? guideSession.stereoNotice() : '');
    if (!stereo && pauseCard.isOpen()) pauseCard.close();
    if (stereo) stereoNotice.place(width, height, cardboardCalibration.spacingPx());
    const nowMs = performance.now();
    // Holding the viewer's button leaves the viewer: the moment the hold is long enough, so the wearer knows.
    if (cardboard.isActive() && !cardboard.isCalibrating() && viewerButton.held(nowMs)) cardboard.exit();
    const deltaMs = nowMs - lastFrameMs;
    // Every frame, whatever is showing: an ease must always be able to finish or stop. The guide just before, so a
    // cue it fires takes effect in this frame.
    guideSession.update(deltaMs);
    viewControl.update(deltaMs);
    dip.update(deltaMs);
    // In AR the camera is the device's, put in the Earth frame where the window was placed.
    if (ar) arRunner.update(frame, camera);
    if (position) {
      if (!ar) look.updateCamera(camera, position, sensors.getAttitude(), screen.orientation?.angle ?? 0);
      // Turn the sky to where the Earth's rotation has it now.
      const date = clock.now();
      const m = icrsToEcefMatrix(date);
      skyRotation.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
      inertialRoot.quaternion.setFromRotationMatrix(skyRotation);
      skyRoot.quaternion.copy(inertialRoot.quaternion);
      skyRoot.position.copy(camera.position);
      skyUniforms.uObserverUp.value.copy(camera.position).normalize();
      let spyglassFrame: SpyglassFrame | undefined;
      if (stereo && !cardboard.isCalibrating()) {
        camera.getWorldDirection(headForward);
        const candidate = labels.skyTargetNearViewCenter(camera, THREE.MathUtils.degToRad(CAPTURE_DEG));
        spyglass.update(headForward, candidate, deltaMs);
        camera.getWorldQuaternion(headOrientation);
        spyglass.tilt(headOrientation, deltaMs);
        const gesture = headGestures.update(headOrientation, deltaMs);
        if (gesture) {
          lastHeadGesture = gesture;
          // The spyglass's first, as the button is; a nod it passes on may go on at a guide's continue step.
          if (gesture === 'nod') {
            if (spyglass.claims(candidate) || !guideSession.onViewerInput('nod')) spyglass.deeper(candidate);
          } else spyglass.back();
        }
        const view = spyglass.view();
        if (view) {
          spyglassFrame = {
            direction: view.target.directionInto(spyglassDirection),
            fovDeg: view.fovDeg,
            heightCss: 2 * lensRadiusPx(stereoRig.left, height),
          };
        }
      }
      lazyLayers.update({ date, camera, position, deltaMs, eyes: stereo ? 2 : 1, spyglass: spyglassFrame });
    }
    lastFrameMs = nowMs;
    // A layer swaps the surface map without telling anyone: the HUD's note about it follows.
    if (imageryStatus !== 'ready' && globe.hasSurfaceImagery() !== imageryShown) renderHud();
    labels.setSkyThroughEarth(skyUniforms.uBelowHorizon.value > 0);
    globe.setHorizonLineShown(skyUniforms.uBelowHorizon.value < WHOLE_SKY_BRIGHTNESS);
    if (ar) {
      if (showEarth) globe.update(camera, xrFramebufferHeight());
      renderer.render(scene, arRunner.renderCamera);
    } else if (stereo) {
      const eyeWidth = Math.floor(width / 2);
      if (cardboard.isCalibrating()) {
        cardboardCalibration.update(headRollRad(camera, skyUniforms.uObserverUp.value), deltaMs, width, height);
      }
      stereoRig.update(camera, eyeWidth, height, cardboardCalibration.spacingPx());
      const view = spyglass.view();
      const fuse = spyglass.fuse();
      if (view) view.target.directionInto(spyglassDirection);
      else if (fuse) fuse.target.directionInto(spyglassDirection);
      labels.setSpyglassHole(view ? spyglassDirection : null, THREE.MathUtils.degToRad(SPYGLASS_DEG / 2));
      labels.update(stereoRig.left, eyeWidth, height, stereoRig.right, skyRotation);
      pointerEyes.eyeWidth = eyeWidth;
      gazePointer.update(viewControl.awaitedGaze(), camera, width, height, pointerEyes);
      // Paused in the viewer, the guide's choices stand where the wearer was looking, chosen by a look.
      if (guideSession.paused() && !cardboard.isCalibrating()) {
        if (!pauseCard.isOpen()) pauseCard.open(camera);
        const choice = pauseCard.update(camera.getWorldDirection(headForward), deltaMs);
        if (choice) guideSession.choosePauseCard(choice);
        else pauseCard.place(stereoRig.left, stereoRig.right, eyeWidth, height);
      } else if (pauseCard.isOpen()) pauseCard.close();
      stereoRig.render(
        renderer,
        scene,
        width,
        height,
        (eye) => globe.update(eye, renderer.domElement.height),
        (eye, viewport) => {
          if (view) {
            spyglassLens.drawLens(renderer, scene, eye, viewport, spyglassDirection, view.fovDeg, (lensCamera, heightPx) =>
              globe.update(lensCamera, heightPx)
            );
          } else if (fuse) {
            spyglassLens.drawFuse(renderer, eye, viewport, spyglassDirection, fuse.fraction);
          }
        }
      );
    } else {
      if (position) {
        globe.update(camera, renderer.domElement.height);
        labels.update(camera, width, height, undefined, skyRotation);
        compassBar.update(camera, position, width);
        gazePointer.update(viewControl.awaitedGaze(), camera, width, height);
      }
      renderer.render(scene, camera);
    }
    if (voiceOverlay.isShown()) voiceOverlay.place(stereo, width, height, cardboardCalibration.spacingPx());
    frameCount++;
  }

  function xrFramebufferHeight(): number {
    const layer = renderer.xr.getBaseLayer();
    if (layer && 'framebufferHeight' in layer) return layer.framebufferHeight;
    if (layer && 'textureHeight' in layer) return layer.textureHeight;
    return renderer.domElement.height;
  }

  sensors.start();
  renderHud();
  renderer.setAnimationLoop(animate);

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
    viewControl,
    getSensorState: () => sensorState,
    getAppState: () => appState,
    getAvailableModes: () => availableModes,
    getFrameCount: () => frameCount,
    getVisibleLabels: () => labels.visibleNames(),
    getDate: () => clock.now(),
    getGuide: () => guideSession.getGuide(),
    getSpyglass: () => {
      const state = spyglass.getState();
      return {
        state: state.kind,
        target: 'target' in state ? state.target.name : null,
        fovDeg: spyglass.view()?.fovDeg ?? null,
        lastHeadGesture,
      };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      arRunner.dispose();
      spyglassLens.dispose();
      arControls.dispose();
      sensors.stop();
      window.removeEventListener('resize', onResize);
      screen.orientation?.removeEventListener('change', renderHud);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      for (const layer of fatLineLayers) layer.dispose();
      quakes?.dispose();
      layersPanel.dispose();
      cardboard.dispose();
      cardboardCalibration.dispose();
      voice.dispose();
      voiceOverlay.dispose();
      removeTalkButton();
      lazyLayers.dispose();
      labels.dispose();
      dip.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      hud.remove();
      compassBar.dispose();
      gazePointer.dispose();
      // Before the captions: leaving the guide takes its captions down.
      guideSession.dispose();
      document.getElementById('layers-toggle')?.removeEventListener('click', closeGuideList);
      guideList.dispose();
      captions.dispose();
      stereoNotice.dispose();
      pauseCard.dispose();
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
