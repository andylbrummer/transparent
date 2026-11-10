import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { raySphere } from '../../render/deep-shell';
import { rampColor } from '../weather/ramps';
import tomography from './layer';
import { DVS_CLEAR_BELOW, DVS_FULL_FROM, DVS_RAMP, TOMOGRAPHY_SHELLS, signedPercent, tomographyId } from './shells';
import { TOMOGRAPHY_SHADE_GLSL, shellLabelText } from './tomography';

describe('raySphere', () => {
  const camera = new THREE.Vector3(0, 0, EARTH_RADIUS_M);
  const down = new THREE.Vector3(0, 0, -1);

  it('meets a sphere inside the Earth twice from the surface: under the feet, then on the far side', () => {
    const radius = EARTH_RADIUS_M - 2_850_000;
    const hit = raySphere(camera, down, radius);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(2_850_000, 0);
    expect(hit![1]).toBeCloseTo(2 * EARTH_RADIUS_M - 2_850_000, 0);
  });

  it('misses outside the limb, which is asin(r / R) from straight down', () => {
    const radius = EARTH_RADIUS_M - 2_850_000;
    const limb = Math.asin(radius / EARTH_RADIUS_M);
    const at = (angle: number): THREE.Vector3 => new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
    expect(raySphere(camera, at(limb - 0.01), radius)).not.toBeNull();
    expect(raySphere(camera, at(limb + 0.01), radius)).toBeNull();
  });

  it('puts both crossings behind a camera looking away', () => {
    const hit = raySphere(camera, new THREE.Vector3(0, 0, 1), EARTH_RADIUS_M - 150_000);
    expect(hit![1]).toBeLessThan(0);
  });
});

describe('the tomography layers', () => {
  it('are one switch per depth, exclusive, inside the Earth, off until asked for', () => {
    expect(tomography.map((layer) => layer.id)).toEqual(TOMOGRAPHY_SHELLS.map((shell) => tomographyId(shell.depthKm)));
    for (const layer of tomography) {
      expect(layer.section).toBe('Inside the Earth');
      expect(layer.exclusiveGroup).toBe('tomography');
      expect(layer.defaultOn).toBeUndefined();
    }
    expect(tomography[0].label).toBe('Mantle at 150 km (tomography)');
    expect(tomography[5].label).toBe('Mantle at 2,850 km (tomography)');
  });

  it('say that it is a model, which one, and the scale of each slice', () => {
    for (const [i, layer] of tomography.entries()) {
      expect(layer.caption).toContain('a model (SEMUCB-WM1)');
      expect(layer.caption).toContain(`slow −${TOMOGRAPHY_SHELLS[i].rangePercent} % … fast +${TOMOGRAPHY_SHELLS[i].rangePercent} %`);
      expect(layer.credits[0].source).toContain('French, S.W. & Romanowicz, B.A. (2014)');
    }
    expect(signedPercent(-1.5)).toBe('−1.5 %');
    expect(shellLabelText(TOMOGRAPHY_SHELLS[5])).toBe('2,850 km · shear-wave speed (model)');
  });

  it('colour slow rock red and fast rock blue, symmetric about zero', () => {
    const [slowR, , slowB] = rampColor(DVS_RAMP, -1);
    const [fastR, , fastB] = rampColor(DVS_RAMP, 1);
    expect(slowR).toBeGreaterThan(slowB + 100);
    expect(fastB).toBeGreaterThan(fastR + 100);
    expect(DVS_RAMP.map(([value]) => value)).toEqual(DVS_RAMP.map(([value]) => 0 - value).reverse());
  });

  it('decode the anomaly as the bake encoded it: grey 128 is zero, 1 and 255 the ends of the scale', () => {
    expect(TOMOGRAPHY_SHADE_GLSL).toContain('(texel.r * 255.0 - 128.0) / 127.0');
    expect(TOMOGRAPHY_SHADE_GLSL).toContain(`smoothstep(${DVS_CLEAR_BELOW.toFixed(2)}, ${DVS_FULL_FROM.toFixed(2)}, abs(v))`);
    // The 2850 km slice spans ±3 %: grey 15 is the −2.67 % under southern Africa.
    expect(((15 - 128) / 127) * TOMOGRAPHY_SHELLS[5].rangePercent).toBeCloseTo(-2.67, 2);
  });
});
