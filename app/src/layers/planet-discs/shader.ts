/**
 * One planet's disc: a flat panel on the sky whose every pixel is traced
 * back to the planet - a spheroid turned the way the planet is turned,
 * lit from where the Sun is, with Saturn's rings in its equator, each
 * casting its shadow on the other. Phase, the tilt of the rings and the
 * flattening of the giants all come from that geometry.
 *
 * Lengths are in equatorial radii, vectors in the planet's own axes
 * (z the north pole).
 */

import { SATURN_RINGS, planetShape } from '@transparent-earth/core';

export const DISC_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldDir;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldDir = world.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** GLSL summing the ring bands at radius `rho`: optical depth and albedo, edges softened over `s`. */
export function ringProfileGlsl(): string {
  const radius = planetShape('saturn').equatorialRadiusKm;
  const f = (km: number): string => (km / radius).toFixed(5);
  return SATURN_RINGS.map(
    (band) =>
      `w = smoothstep(${f(band.innerKm)} - s, ${f(band.innerKm)} + s, rho) * (1.0 - smoothstep(${f(band.outerKm)} - s, ${f(band.outerKm)} + s, rho));` +
      ` tau += w * ${band.opticalDepth.toFixed(3)}; albedo += w * ${band.albedo.toFixed(3)};`
  ).join('\n      ');
}

export const DISC_FRAGMENT_SHADER = `
  #define PI 3.141592653589793
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uColor;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uView;
  uniform vec3 uSun;
  uniform float uAxisRatio;
  uniform float uExtent;
  uniform float uRings;
  uniform float uScatter;
  uniform vec3 uRingColor;
  uniform float uRingGain;
  uniform vec3 uObserverUp;
  uniform float uBelowHorizon;
  varying vec2 vUv;
  varying vec3 vWorldDir;

  // Optical depth of the rings at radius rho; albedo by the way.
  float ringDepth(float rho, float s, out float albedo) {
    float tau = 0.0;
    float w;
    albedo = 0.0;
    ${ringProfileGlsl()}
    return tau;
  }

  // Whether the ray from o along unit d meets the planet.
  bool meetsPlanet(vec3 o, vec3 d) {
    vec3 os = vec3(o.xy, o.z / uAxisRatio);
    vec3 ds = vec3(d.xy, d.z / uAxisRatio);
    float od = dot(os, ds);
    return od < 0.0 && dot(os, os) - od * od / dot(ds, ds) < 1.0;
  }

  void main() {
    vec2 q = (vUv * 2.0 - 1.0) * uExtent;
    // The pixel's line of sight passes through P; uView points from the planet to the eye.
    vec3 P = q.x * uRight + q.y * uUp;

    vec3 os = vec3(P.xy, P.z / uAxisRatio);
    vec3 vs = vec3(uView.xy, uView.z / uAxisRatio);
    float vv = dot(vs, vs);
    float ov = dot(os, vs);
    // Distance of the line of sight from the centre, in the space where the planet is a unit ball.
    float miss = sqrt(max(dot(os, os) - ov * ov / vv, 0.0));
    float soft = max(fwidth(miss), 1e-4);
    float cover = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, miss);
    vec3 planet = vec3(0.0);
    float tPlanet = -1e9;
    if (cover > 0.0) {
      tPlanet = (-ov + sqrt(max(ov * ov - vv * (dot(os, os) - 1.0), 0.0))) / vv;
      vec3 S = P + tPlanet * uView;
      vec3 n = normalize(vec3(S.xy, S.z / (uAxisRatio * uAxisRatio)));
      // Maps are plate carree in planetographic latitude, longitude 0 in the middle, east to the right.
      vec2 uv = vec2(0.5 + atan(S.y, S.x) / (2.0 * PI), 0.5 + asin(clamp(n.z, -1.0, 1.0)) / PI);
      vec3 albedo = mix(uColor, texture2D(uMap, uv).rgb, uHasMap);
      float mu0 = dot(n, uSun);
      float mu = max(dot(n, uView), 0.0);
      // Clouds scatter like a matt ball and darken to the limb; bare rock (uScatter 1) stays bright to its edge.
      float lit = smoothstep(0.0, 0.03, mu0) * mix(max(mu0, 0.0), 2.0 * max(mu0, 0.0) / (max(mu0, 0.0) + mu + 1e-4), uScatter);
      if (uRings > 0.5 && S.z * uSun.z < 0.0) {
        // The Sun is on the other side of the ring plane from here: its light came through the rings.
        vec3 through = S + (-S.z / uSun.z) * uSun;
        float unused;
        lit *= exp(-ringDepth(length(through.xy), 0.01, unused) / max(abs(uSun.z), 0.02));
      }
      planet = albedo * min(lit, 1.2);
    }

    vec4 ring = vec4(0.0);
    float tRing = -1e9;
    if (uRings > 0.5 && abs(uView.z) > 1e-4) {
      tRing = -P.z / uView.z;
      vec3 R = P + tRing * uView;
      float rho = length(R.xy);
      float albedo;
      float tau = ringDepth(rho, max(fwidth(rho), 1e-4), albedo);
      if (tau > 0.0) {
        float mu = max(abs(uView.z), 0.02);
        float mu0 = max(abs(uSun.z), 0.02);
        // Single scattering by a thin layer: reflected from the sunlit face, or leaking through to the dark one.
        float light = uView.z * uSun.z > 0.0
          ? mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0)))
          : mu0 / max(abs(mu0 - mu), 1e-3) * abs(exp(-tau / mu0) - exp(-tau / mu));
        if (meetsPlanet(R, uSun)) light = 0.0;
        ring = vec4(uRingColor * albedo * light * uRingGain, 1.0 - exp(-tau / mu));
      }
    }

    // Premultiplied light; whichever is nearer the eye (larger t) goes over the other.
    vec4 body = vec4(planet * cover, cover);
    vec4 light = (tRing > tPlanet || cover <= 0.0) ? ring + body * (1.0 - ring.a) : body + ring * (1.0 - cover);
    float horizon = mix(uBelowHorizon, 1.0, smoothstep(-0.005, 0.005, dot(normalize(vWorldDir), uObserverUp)));
    gl_FragColor = light * horizon;
  }
`;
