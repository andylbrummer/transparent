/**
 * The Moon: a mapped sphere at its true distance in the Earth-centred
 * inertial frame, so where the user stands moves it against the stars by
 * up to a degree, as it does in the sky; turned by its real orientation,
 * so libration shows; and lit from where the Sun really is, so the phase,
 * the terminator and the tilt of the crescent come from geometry and
 * nothing is drawn by rule.
 *
 * Map: app/public/sky/moon.jpg (tools/pipeline/generate_moon.py).
 */

import * as THREE from 'three';
import {
  AU_KM,
  MOON_RADIUS_KM,
  moonBodyToIcrs,
  moonGeocentricKm,
  moonPhase,
  sunGeocentricAu,
  type MoonPhase,
} from '@transparent-earth/core';
import { RENDER_ORDER } from '../../render/order';
import { SkyPoints } from '../../render/sky-points';
import { MovingLabel, labelDropPx } from '../sun/moving-label';
import type { LayerContext, LayerInstance } from '../types';

/** After the Sun and its corona (sky + 0.01 … 0.04): the Moon passes in front of them. */
const MOON_RENDER_ORDER = RENDER_ORDER.sky + 0.06;
/** The Moon moves its own width in an hour: twice a second is smooth at any zoom. */
const EPHEMERIS_INTERVAL_MS = 500;
/** The marker that stands for the Moon while its disc is only a few pixels wide: CSS px. */
const MARKER_SIZE_PX = 26;
/** The marker gives way to the disc as that grows from the first to the second size, CSS px. */
const MARKER_FADE_PX: readonly [number, number] = [12, 36];
const LABEL_MIN_DROP_PX = 16;
/**
 * Earthshine: the night side lit by the Earth. It is real and strongest
 * near new Moon, when a nearly full Earth hangs in the lunar sky; this is
 * only its presence, a fixed faint level scaled by the Earth's phase, not
 * photometry.
 */
const EARTHSHINE = 0.035;

const VERTEX_SHADER = `
  varying vec3 vBody;
  varying vec3 vWorldDir;
  void main() {
    // The unit sphere's own coordinates are the selenographic frame.
    vBody = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = `
  #define PI 3.141592653589793
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform vec3 uViewDir;
  uniform float uEarthshine;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  varying vec3 vBody;
  varying vec3 vWorldDir;
  void main() {
    vec3 n = normalize(vBody);
    // Selenographic longitude (east positive, 0 at the map's centre) and latitude.
    vec2 uv = vec2(0.5 + atan(n.y, n.x) / (2.0 * PI), 0.5 + asin(clamp(n.z, -1.0, 1.0)) / PI);
    vec3 albedo = texture2D(uMap, uv).rgb;
    float mu0 = dot(n, uSunDir);
    float mu = max(dot(n, uViewDir), 0.0);
    // Lommel-Seeliger: the dusty Moon scatters so that a full Moon is evenly bright to its edge,
    // unlike a matt ball. Softened over the terminator's last degree to spare the edge pixels.
    float lit = smoothstep(0.0, 0.02, mu0) * 2.0 * mu0 / (max(mu0, 0.0) + mu + 1e-4);
    vec3 light = albedo * (min(lit, 1.2) + uEarthshine);
    float horizon = mix(uBelowHorizon, 1.0, smoothstep(-0.005, 0.005, dot(normalize(vWorldDir), uObserverUp)));
    gl_FragColor = vec4(light, horizon);
  }
`;

/** "Waxing gibbous 78%". */
export function phaseText(phase: MoonPhase): string {
  return `${phase.name} ${Math.round(phase.illuminatedFraction * 100)}%`;
}

export function markerOpacity(discPx: number): number {
  const t = (discPx - MARKER_FADE_PX[0]) / (MARKER_FADE_PX[1] - MARKER_FADE_PX[0]);
  return 1 - Math.max(0, Math.min(1, t));
}

export async function createMoonLayer(context: LayerContext): Promise<LayerInstance> {
  const texture = await new THREE.TextureLoader().loadAsync(context.assetUrl('sky/moon.jpg'));
  texture.colorSpace = THREE.NoColorSpace;
  // Mipmaps stay off: the atan seam on the far side would pick the coarsest level along a line.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uMap: { value: texture },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uViewDir: { value: new THREE.Vector3(1, 0, 0) },
      uEarthshine: { value: 0 },
      uObserverUp: context.skyUniforms.uObserverUp,
      uBelowHorizon: context.skyUniforms.uBelowHorizon,
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // Only the hemisphere facing the eye: nothing sorts the far one behind it.
    side: THREE.FrontSide,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  sphere.name = 'moon';
  sphere.frustumCulled = false;
  sphere.renderOrder = MOON_RENDER_ORDER;
  sphere.scale.setScalar(MOON_RADIUS_KM * 1000);
  context.inertialRoot.add(sphere);

  const marker = new SkyPoints(
    new Float32Array(3),
    new Float32Array([MARKER_SIZE_PX]),
    new Float32Array([0.85, 0.88, 0.95]),
    context.skyUniforms,
    { name: 'moon-marker', shape: 'ring', renderOrder: MOON_RENDER_ORDER }
  );
  context.skyRoot.add(marker.object);
  const label = new MovingLabel(context, 6.33, { fontPx: 11, color: '#e6ebf5' });

  const bodyRotation = new THREE.Matrix4();
  const toBody = new THREE.Matrix3();
  const inertialToWorld = new THREE.Quaternion();
  const observer = new THREE.Vector3();
  const moonPosition = new THREE.Vector3();
  const sunPosition = new THREE.Vector3();
  const topocentric = new THREE.Vector3();
  let heightCss = window.innerHeight;
  let lastMs = NaN;
  let text = '';
  let angularDiameter = 0.009;

  return {
    setVisible(visible) {
      sphere.visible = visible;
      marker.object.visible = visible;
      label.setVisible(visible);
    },
    setResolution(_widthCss, height) {
      heightCss = height;
    },
    update(frame) {
      const ms = frame.date.getTime();
      if (!(Math.abs(ms - lastMs) < EPHEMERIS_INTERVAL_MS)) {
        lastMs = ms;
        const moon = moonGeocentricKm(frame.date);
        const sun = sunGeocentricAu(frame.date);
        moonPosition.set(moon[0], moon[1], moon[2]).multiplyScalar(1000);
        sunPosition.set(sun[0], sun[1], sun[2]).multiplyScalar(AU_KM * 1000);
        sphere.position.copy(moonPosition);
        const m = moonBodyToIcrs(frame.date);
        bodyRotation.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
        sphere.quaternion.setFromRotationMatrix(bodyRotation);
        // A rotation's inverse is its transpose: ICRS → the Moon's own axes, for the light and the eye.
        toBody.setFromMatrix4(bodyRotation).transpose();
        // Where the eye is, in the inertial frame: the camera's Earth-fixed place, turned back to the stars.
        inertialToWorld.copy(context.inertialRoot.quaternion).invert();
        observer.copy(frame.camera.position).applyQuaternion(inertialToWorld);
        topocentric.copy(moonPosition).sub(observer);
        const distanceM = topocentric.length();
        angularDiameter = 2 * Math.asin((MOON_RADIUS_KM * 1000) / distanceM);
        (material.uniforms.uSunDir.value as THREE.Vector3).copy(sunPosition).sub(moonPosition).normalize().applyMatrix3(toBody);
        (material.uniforms.uViewDir.value as THREE.Vector3).copy(topocentric).multiplyScalar(-1 / distanceM).applyMatrix3(toBody);
        const phase = moonPhase(
          [topocentric.x, topocentric.y, topocentric.z],
          [sunPosition.x - observer.x, sunPosition.y - observer.y, sunPosition.z - observer.z]
        );
        // The Earth in the Moon's sky is at the opposite phase.
        material.uniforms.uEarthshine.value = EARTHSHINE * (1 - phase.illuminatedFraction);
        topocentric.multiplyScalar(1 / distanceM);
        marker.positions.setXYZ(0, topocentric.x, topocentric.y, topocentric.z);
        marker.positions.needsUpdate = true;
        label.position.copy(topocentric);
        text = `Moon · ${phaseText(phase)}`;
      }
      const discPx = (angularDiameter / ((frame.camera.fov * Math.PI) / 180)) * heightCss;
      marker.setOpacity(0.8 * markerOpacity(discPx));
      label.set(text, labelDropPx(discPx, LABEL_MIN_DROP_PX));
    },
    dispose() {
      sphere.removeFromParent();
      sphere.geometry.dispose();
      texture.dispose();
      material.dispose();
      marker.dispose();
      label.dispose();
    },
  };
}
