import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { ecefAtAltitude } from '../../render/geo-markers';
import {
  craterAgeText,
  craterLabelText,
  craterMarkerSizePx,
  craterMarkers,
  craterRingPositions,
  formatAgeMa,
  type Crater,
  type CraterData,
} from './craters';
import craters, { CRATER_COLOR, TRUE_RING_MIN_KM } from './layer';

/** Real rows of app/public/geo/craters.json (Schmieder & Kring 2020, Table 1). */
const CHICXULUB: Crater = {
  name: 'Chicxulub',
  country: 'Mexico',
  lon: -89.5,
  lat: 21.333,
  diameterKm: 180,
  diameterText: '180',
  ageMa: 66.052,
  ageText: '66.052 ± 0.043',
};
const BARRINGER: Crater = {
  name: 'Barringer (Meteor Crater)',
  country: 'United States',
  lon: -111.017,
  lat: 35.033,
  diameterKm: 1.186,
  diameterText: '1.186',
  ageMa: 0.056,
  ageText: '~0.056?; 0.0611 ± 0.0048',
};
const KAALI: Crater = {
  name: 'Kaali (Kaalijärv) (Field)',
  country: 'Estonia',
  lon: 22.667,
  lat: 58.367,
  diameterKm: 0.11,
  diameterText: '0.11',
  ageMa: 0.00324,
  ageText: '~0.00324',
};
const DATA: CraterData = { craters: [CHICXULUB, BARRINGER, KAALI] };

describe('crater ages', () => {
  it('are shortened to the unit that suits them', () => {
    expect(formatAgeMa(2023)).toBe('2.02 Ga');
    expect(formatAgeMa(66.052)).toBe('66.1 Ma');
    expect(formatAgeMa(215.56)).toBe('216 Ma');
    expect(formatAgeMa(300)).toBe('300 Ma');
    expect(formatAgeMa(0.12)).toBe('120 ka');
    expect(formatAgeMa(0.00324)).toBe('3.24 ka');
    expect(formatAgeMa(0.000072)).toBe('72 yr');
  });

  it('keep what the paper says about how well the age is known', () => {
    expect(craterAgeText('66.052 ± 0.043')).toBe('66.1 Ma');
    expect(craterAgeText('<1880')).toBe('<1.88 Ga');
    expect(craterAgeText('~0.00324')).toBe('~3.24 ka');
    // A range is all that is known: it is not collapsed to its first number.
    expect(craterAgeText('2005–168')).toBe('2005–168 Ma');
    expect(craterAgeText('~453 to 430')).toBe('~453–430 Ma');
    // Of several estimates, the first.
    expect(craterAgeText('125 ± 1; ~121.8 to 123.8?')).toBe('125 Ma');
    expect(craterAgeText('~0.056?; 0.0611 ± 0.0048')).toBe('~56 ka');
    expect(craterAgeText('')).toBeNull();
  });
});

describe('crater labels and markers', () => {
  it('name each structure with its diameter and age', () => {
    expect(craterLabelText(CHICXULUB)).toBe('◯ Chicxulub · 180 km · 66.1 Ma');
    expect(craterLabelText(BARRINGER)).toBe('◯ Barringer (Meteor Crater) · 1.186 km · ~56 ka');
    expect(craterLabelText(KAALI)).toBe('◯ Kaali (Kaalijärv) (Field) · 110 m · ~3.24 ka');
  });

  it('mark every crater with a ring that grows with its size, within bounds', () => {
    const markers = craterMarkers(DATA);
    expect(markers.map((m) => m.shape)).toEqual(['ring', 'ring', 'ring']);
    expect(markers[0].color).toBe(CRATER_COLOR);
    expect(craterMarkerSizePx(0.1)).toBe(7);
    expect(craterMarkerSizePx(250)).toBe(13);
    expect(craterMarkerSizePx(10)).toBeGreaterThan(craterMarkerSizePx(1));
  });

  it('ring only the large ones at true size: every ring point half a diameter from the centre, on the surface', () => {
    const positions = craterRingPositions(DATA);
    // Chicxulub alone is over the threshold: 64 segments.
    expect(TRUE_RING_MIN_KM).toBe(10);
    expect(positions.length).toBe(64 * 6);
    const centre = ecefAtAltitude(CHICXULUB.lon, CHICXULUB.lat, 0, new THREE.Vector3());
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      point.fromArray(positions, i);
      expect(point.length() / EARTH_RADIUS_M).toBeCloseTo(1, 6);
      expect((point.angleTo(centre) * EARTH_RADIUS_M) / 1000).toBeCloseTo(90, 1);
    }
  });
});

describe('the crater layer', () => {
  it('is a surface layer, off until asked for, crediting the paper', () => {
    expect(craters.id).toBe('impact-craters');
    expect(craters.section).toBe('Surface');
    expect(craters.defaultOn).toBeUndefined();
    expect(craters.credits[0].licence).toBe('CC BY 4.0');
    expect(craters.credits[0].source).toContain('Schmieder, M. & Kring, D.A. (2020)');
  });
});
