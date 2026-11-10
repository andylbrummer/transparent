import { describe, expect, it } from 'vitest';
import { LAYER_SPECS, heightText, labelText, longitudeText, tidyName } from './groups';
import type { GpRecord } from './orbit-math';
import layers from './layer';
import { STALE_AGE_DAYS, elementsStatus } from './satellites';

const record = (name: string, norad = 1): GpRecord => ({
  name,
  norad,
  epochMs: 0,
  epoch: '',
  meanMotion: 15,
  eccentricity: 0,
  inclination: 0,
  raOfAscNode: 0,
  argOfPericenter: 0,
  meanAnomaly: 0,
  bstar: 0,
  meanMotionDot: 0,
  meanMotionDdot: 0,
});

describe('satellite layers', () => {
  it('has a spec for every switch and a switch for every spec', () => {
    expect(layers.map((layer) => layer.id).sort()).toEqual(Object.keys(LAYER_SPECS).sort());
    for (const layer of layers) {
      expect(layer.section).toBe('Near space');
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.credits.length).toBeGreaterThan(0);
    }
  });

  it('names the stations and leaves their modules as points', () => {
    const spec = LAYER_SPECS['sat-stations'];
    expect(spec.naming(record('ISS (ZARYA)', 25544), 0)?.name).toBe('ISS');
    expect(spec.naming(record('CSS (TIANHE)', 48274), 0)?.name).toBe('Tiangong');
    expect(spec.naming(record('ISS (NAUKA)', 49044), 0)).toBeNull();
  });

  it('names navigation satellites by constellation and number', () => {
    const spec = LAYER_SPECS['sat-gnss'];
    expect(spec.naming(record('GPS BIIR-5  (PRN 22)'), 0)?.name).toBe('GPS 22');
    expect(spec.naming(record('GSAT0206 (GALILEO 10)'), 1)?.name).toBe('Galileo 10');
    expect(spec.naming(record('COSMOS 2477 (745)'), 2)?.name).toBe('GLONASS 745');
    expect(spec.naming(record('BEIDOU-3 M1 (C19)'), 3)?.name).toBe('BeiDou C19');
  });

  it('names the weather satellites of the geostationary ring by the longitude they keep', () => {
    const spec = LAYER_SPECS['sat-geo'];
    const goes = spec.naming(record('GOES 19'), 0);
    expect(goes && labelText(goes, 35786, -75.2)).toBe('GOES 19 · 75.2°W');
    expect(spec.naming(record('METEOSAT-12 (MTG-I1)'), 0)?.name).toBe('Meteosat-12');
    expect(spec.naming(record('SES-1'), 0)).toBeNull();
  });

  it('gives the telescopes the names people know', () => {
    const spec = LAYER_SPECS['sat-science'];
    expect(spec.naming(record('HST'), 0)?.name).toBe('Hubble');
    expect(spec.naming(record('CXO'), 0)?.name).toBe('Chandra');
    expect(spec.naming(record('FGRST (GLAST)'), 0)?.name).toBe('Fermi');
    expect(spec.naming(record('MMS 3'), 0)).toBeNull();
  });
});

describe('texts', () => {
  it('tidies catalogue names', () => {
    expect(tidyName('COSMOS 1408 DEB')).toBe('Cosmos 1408 DEB');
    expect(tidyName('SL-16 R/B')).toBe('SL-16 R/B');
    expect(tidyName('LANDSAT 9')).toBe('Landsat 9');
    expect(tidyName('METEOSAT-12')).toBe('Meteosat-12');
  });

  it('writes heights and longitudes', () => {
    expect(heightText(423.4)).toBe('423 km');
    expect(heightText(19970)).toBe('20,000 km');
    expect(heightText(5432)).toBe('5,430 km');
    expect(longitudeText(-75.196)).toBe('75.2°W');
    expect(longitudeText(140.7)).toBe('140.7°E');
    expect(longitudeText(181)).toBe('179.0°W');
  });

  it('says whose elements are shown and how old', () => {
    const epoch = Date.UTC(2026, 10, 9, 14, 20);
    expect(elementsStatus('live', epoch, epoch + 3600e3)).toEqual({ text: 'live · elements of 9 Nov 14:20 UTC', tone: 'live' });
    expect(elementsStatus('baked', epoch, epoch + 3600e3)).toEqual({ text: 'offline · elements of 9 Nov 2026', tone: 'stale' });
    expect(elementsStatus('cached', epoch, epoch).tone).toBe('stale');
    const old = elementsStatus('live', epoch, epoch + (STALE_AGE_DAYS + 6) * 86400e3);
    expect(old.tone).toBe('stale');
    expect(old.text).toBe('elements of 9 Nov 2026, 20 d from the shown time · approximate');
  });
});
