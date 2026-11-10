import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EARTH_RADIUS_M } from '@transparent-earth/core';
import { MARKER_SHAPES } from '../../render/geo-markers';
import { LAYER_SECTIONS } from '../types';
import { ROUTE_PEAK_FRACTION, airportLabelText, airportLabels, airportMarkers, routeArcSegments, routeGeometry, routeStrength, type Airport, type RouteData } from './air';
import { cableLabelText, cableLabels, landingLabelText, landingMarkers, splitCableLines, type CableData } from './cables';
import { SET_VIEWS, landmarkLabels, landmarkMarkers, type Landmark } from './landmarks';
import humanWorld from './layer';
import { nuclearLabels, plantLabelText, plantLabels, plantMarkers, type PowerPlantData } from './power';
import { FEATURED_RANK, OTHER_RANK, formatDay, splitRanked, thousands } from './shared';
import { shipDensityAlpha } from './ship-density';
import {
  FUEL_COLORS,
  OTHER_FUEL_COLOR,
  SHIP_DENSITY_DECADES,
  SHIP_DENSITY_FLOOR,
  SHIP_DENSITY_RAMP,
  bandLegend,
  fuelColor,
  plantSizePx,
  shipDensityCode,
} from './styles';
import { portMarkers, portSizePx, waterLabels, type WaterData } from './waters';

/**
 * In the shape of app/public/geo/cables.json. MAREA's row and the two landings are the file's; the other
 * cables are made up to exercise the rules (planned with and without a year, a length measured off the drawing).
 */
const CABLES: CableData = {
  asOf: '2022-11-14',
  quantumPerDegree: 100,
  cables: [
    { name: 'Project Waterworth', lengthKm: 50000, year: null, planned: true, lon: 20, lat: -40 },
    { name: '2Africa', lengthKm: 45000, year: 2024, planned: false, lon: 10, lat: -20 },
    { name: 'SeaMeWe-6', lengthKm: 21700, year: 2027, planned: true, lon: 60, lat: 15 },
    { name: 'MAREA', lengthKm: 6605, year: 2018, planned: false, lon: -40.5, lat: 40.1 },
    { name: 'Drawn Only', lengthKm: 812, lengthIsDrawn: true, year: 2001, planned: false, lon: 0, lat: 0 },
  ],
  lines: [
    [0, 1800, -3400, 100, 0],
    [1, 0, 0, 100, 100],
    [3, -7598, 3685, 3000, 500, 4305, 141],
    [3, 0, 0, 5, 5],
  ],
  landings: [
    { name: 'Marseille, France', lon: 5.373, lat: 43.294, cables: 8 },
    { name: 'Bilbao, Spain', lon: -2.93, lat: 43.26, cables: 1 },
  ],
};

describe('undersea cables', () => {
  it('names a cable with the year it was lit and its length', () => {
    expect(cableLabelText(CABLES.cables[3])).toBe('MAREA · 2018 · 6,605 km');
    expect(cableLabelText(CABLES.cables[2])).toBe('SeaMeWe-6 · due 2027 · 21,700 km');
    expect(cableLabelText(CABLES.cables[0])).toBe('Project Waterworth · planned · 50,000 km');
    expect(cableLabelText(CABLES.cables[4])).toBe('Drawn Only · 2001 · ~812 km');
  });

  it('parts the lines of cables in service from those only planned, dropping the index', () => {
    const { inService, planned } = splitCableLines(CABLES);
    expect(planned).toEqual([[1800, -3400, 100, 0]]);
    expect(inService).toHaveLength(3);
    expect(inService[1]).toEqual([-7598, 3685, 3000, 500, 4305, 141]);
  });

  it('features the longest cables in service; a planned one is never featured', () => {
    const [featured, others] = cableLabels(CABLES);
    expect(featured.map((l) => l.text.split(' · ')[0])).toEqual(['2Africa', 'MAREA', 'Drawn Only']);
    expect(others.map((l) => l.text.split(' · ')[0])).toEqual(['Project Waterworth', 'SeaMeWe-6']);
    expect(featured[0].priority).toBeLessThan(featured[1].priority);
    expect(featured[1].position.length()).toBeCloseTo(EARTH_RADIUS_M, 0);
  });

  it('names a landing by its town and draws the hubs larger and last', () => {
    expect(landingLabelText(CABLES.landings[0])).toBe('Marseille · 8 cables');
    const markers = landingMarkers(CABLES);
    expect(markers[markers.length - 1].lon).toBe(5.373);
    expect(markers[markers.length - 1].sizePx).toBeGreaterThan(markers[0].sizePx);
  });
});

/** Real rows of app/public/geo/landmarks.json (Wikidata, asked 2026-11-10). */
const EVEREST: Landmark = { name: 'Mount Everest', lon: 86.925, lat: 27.988, links: 238, value: 8849, kind: 'eight-thousander' };
const KOSCIUSZKO: Landmark = { name: 'Mount Kosciuszko', lon: 148.264, lat: -36.456, links: 86, value: 2228, kind: 'seven-summits' };
const KOLA: Landmark = { name: 'Kola Superdeep Borehole', lon: 30.61, lat: 69.397, links: 52, value: 12262, kind: 'borehole' };
const MPONENG: Landmark = { name: 'Mponeng Gold Mine', lon: 27.431, lat: -26.436, links: 13, value: 4000, valueText: 'over 4 km', kind: 'mine' };
const PALOMAR: Landmark = { name: 'Palomar Observatory', lon: -116.865, lat: 33.356, links: 64, kind: 'observatory' };
const ICECUBE: Landmark = { name: 'IceCube Neutrino Observatory', lon: -63.453, lat: -89.99, links: 26, kind: 'neutrino' };
const VIRGO: Landmark = { name: 'Virgo interferometer', lon: 10.504, lat: 43.631, links: 23, kind: 'gw' };
const VLA: Landmark = { name: 'Very Large Array', lon: -107.618, lat: 34.079, links: 34, kind: 'radio' };

describe('landmarks', () => {
  it('draws a summit at its height and a borehole at its bottom', () => {
    const [summit] = landmarkMarkers([EVEREST], SET_VIEWS.mountains);
    expect(summit.altitudeM).toBe(8849);
    expect(summit.shape).toBe('triangle');
    const [hole] = landmarkMarkers([KOLA], SET_VIEWS.deep);
    expect(hole.altitudeM).toBe(-12262);
    const [[label]] = landmarkLabels([KOLA], SET_VIEWS.deep);
    expect(label.position.length()).toBeCloseTo(EARTH_RADIUS_M - 12262, 0);
  });

  it('writes heights and depths, keeping a depth as its source words it', () => {
    expect(SET_VIEWS.mountains.text(EVEREST)).toBe('△ Mount Everest · 8,849 m');
    expect(SET_VIEWS.deep.text(KOLA)).toBe('Kola Superdeep Borehole · 12,262 m down');
    expect(SET_VIEWS.deep.text(MPONENG)).toBe('Mponeng Gold Mine · over 4 km down');
  });

  it('ranks mountains by height and draws the eight-thousanders larger and last', () => {
    const [featured] = landmarkLabels([KOSCIUSZKO, EVEREST], SET_VIEWS.mountains);
    expect(featured.map((l) => l.text)).toEqual(['△ Mount Everest · 8,849 m', '△ Mount Kosciuszko · 2,228 m']);
    const markers = landmarkMarkers([EVEREST, KOSCIUSZKO], SET_VIEWS.mountains);
    expect(markers.map((m) => m.altitudeM)).toEqual([2228, 8849]);
    expect(markers[1].sizePx).toBeGreaterThan(markers[0].sizePx);
  });

  it('colours an instrument by what it looks with and names the detectors ahead of better-known telescopes', () => {
    const view = SET_VIEWS.observatories;
    const colors = [PALOMAR, VLA, ICECUBE, VIRGO].map((o) => view.marker(o).color);
    expect(new Set(colors).size).toBe(4);
    const [featured] = landmarkLabels([PALOMAR, VLA, ICECUBE, VIRGO], view);
    expect(featured.map((l) => l.text)).toEqual([
      'IceCube Neutrino Observatory · neutrinos',
      'Palomar Observatory',
      'Virgo interferometer · gravitational waves',
      'Very Large Array',
    ]);
  });

  it('caps the names of every set at a modest number', () => {
    for (const view of Object.values(SET_VIEWS)) expect(view.featured + view.others).toBeLessThanOrEqual(240);
  });
});

/** Real rows of app/public/geo/power-plants.json (Global Power Plant Database v1.3.0). */
const PLANTS: PowerPlantData = {
  version: '1.3.0 (June 2021)',
  minCapacityMw: 500,
  fuels: ['Coal', 'Hydro', 'Nuclear', 'Petcoke'],
  plants: {
    lon: [111.003, 138.602, 116.0, 0],
    lat: [30.823, 37.429, 40.0, 0],
    mw: [22500, 8212, 7000, 500],
    fuel: [1, 2, 0, 3],
    name: ['Three Gorges Dam', 'Kashiwazaki Kariwa'],
  },
  nuclear: [
    { name: 'Kashiwazaki Kariwa', country: 'Japan', lon: 138.602, lat: 37.429, mw: 8212 },
    { name: 'Bilibino', country: 'Russia', lon: 166.539, lat: 68.05, mw: 48 },
  ],
};

describe('power plants', () => {
  it('sizes a disc so that its area goes with the capacity, within limits', () => {
    expect(plantSizePx(500)).toBeCloseTo(3.5);
    expect(plantSizePx(2000)).toBeCloseTo(7);
    expect(plantSizePx(22500)).toBe(16);
    expect(plantSizePx(48)).toBe(3.5);
  });

  it('colours by fuel, with one colour for the fuels that have none of their own', () => {
    const markers = plantMarkers(PLANTS);
    expect(markers.map((m) => m.color)).toEqual([FUEL_COLORS.Hydro, FUEL_COLORS.Nuclear, FUEL_COLORS.Coal, OTHER_FUEL_COLOR]);
    expect(fuelColor('Geothermal')).toBe(OTHER_FUEL_COLOR);
    expect(new Set(Object.values(FUEL_COLORS)).size).toBe(Object.keys(FUEL_COLORS).length);
  });

  it('names the plants the file names, the largest first', () => {
    expect(plantLabelText('Three Gorges Dam', 'Hydro', 22500)).toBe('Three Gorges Dam · hydro · 22,500 MW');
    const [featured, others] = plantLabels(PLANTS);
    expect(featured.map((l) => l.text)).toEqual(['Three Gorges Dam · hydro · 22,500 MW', 'Kashiwazaki Kariwa · nuclear · 8,212 MW']);
    expect(others).toHaveLength(0);
    const [first, rest] = nuclearLabels(PLANTS.nuclear);
    expect([...first, ...rest].map((l) => l.text)).toEqual(['Kashiwazaki Kariwa · 8,212 MW', 'Bilibino · 48 MW']);
  });
});

describe('ship density', () => {
  it('codes density as the bake does: nothing under the floor, then the decades over 1..255', () => {
    expect(shipDensityCode(SHIP_DENSITY_FLOOR / 2)).toBe(0);
    expect(shipDensityCode(SHIP_DENSITY_FLOOR)).toBeCloseTo(1 / 255, 9);
    expect(shipDensityCode(SHIP_DENSITY_FLOOR * 10 ** SHIP_DENSITY_DECADES)).toBeCloseTo(1, 9);
    expect(shipDensityCode(SHIP_DENSITY_FLOOR * 10)).toBeCloseTo((1 + 254 / SHIP_DENSITY_DECADES) / 255, 9);
  });

  it('leaves water nothing passed over clear and a strait nearly solid', () => {
    expect(shipDensityAlpha(0)).toBe(0);
    expect(shipDensityAlpha(0.04)).toBe(0);
    expect(shipDensityAlpha(0.3)).toBeGreaterThan(0.2);
    expect(shipDensityAlpha(0.3)).toBeLessThan(0.5);
    expect(shipDensityAlpha(0.8)).toBeCloseTo(0.92);
    expect(SHIP_DENSITY_RAMP[0][0]).toBe(0);
    expect(SHIP_DENSITY_RAMP[SHIP_DENSITY_RAMP.length - 1][0]).toBe(1);
  });
});

/** Real names of app/public/geo/waters.json (Natural Earth); the lines are shortened. */
const WATERS: WaterData = {
  quantumPerDegree: 100,
  rivers: [[3124, 3004, 10, 100]],
  lakes: [[3200, -100, 100, 0, 0, 100, -100, -100]],
  riverNames: [
    { name: 'Paraná', lon: -58.09, lat: -20.35, rank: 2, lengthKm: 5036 },
    { name: 'Nile', lon: 30.84, lat: 18.14, rank: 1, lengthKm: 2764 },
  ],
  lakeNames: [
    { name: 'Lake Superior', lon: -88.23, lat: 47.72, rank: 0, areaKm2: 84835 },
    { name: 'Lake Victoria', lon: 33.24, lat: -1.26, rank: 0, areaKm2: 69391 },
  ],
};

describe('rivers, lakes and ports', () => {
  it('features the longest rivers and the largest lakes together', () => {
    const [featured, others] = waterLabels(WATERS);
    expect(featured.map((l) => l.text)).toEqual(['Paraná', 'Nile', 'Lake Superior', 'Lake Victoria']);
    expect(others).toHaveLength(0);
    expect(featured[0].priority).toBeLessThan(featured[1].priority);
    expect(featured[2].priority).toBeLessThan(featured[3].priority);
  });

  it('draws a larger port larger and last', () => {
    expect(portSizePx(3)).toBeGreaterThan(portSizePx(5));
    expect(portSizePx(8)).toBeGreaterThanOrEqual(3);
    const markers = portMarkers([
      { name: 'Singapore', lon: 103.84, lat: 1.27, rank: 4 },
      { name: 'Sint Nicolaas', lon: -69.9, lat: 12.43, rank: 8 },
    ]);
    expect(markers.map((m) => m.lon)).toEqual([-69.9, 103.84]);
  });
});

/** Real rows of app/public/geo/airports.json and air-routes.json. */
const AIRPORTS: Airport[] = [
  { iata: 'LHR', city: 'London', lon: -0.462, lat: 51.471, rank: 2 },
  { iata: 'AUS', city: 'Austin', lon: -97.662, lat: 30.198, rank: 4 },
  { iata: 'XYZ', city: '', lon: 0, lat: 0, rank: 10 },
];
const ROUTES: RouteData = {
  dataDate: '2014-06',
  airports: [
    ['JFK', -73.779, 40.64],
    ['LHR', -0.462, 51.471],
    ['SIN', 103.994, 1.35],
  ],
  routes: [
    [0, 1, 8],
    [1, 2, 3],
  ],
};

describe('airports and routes', () => {
  it('draws the hubs larger and last, and names them with their city', () => {
    const markers = airportMarkers(AIRPORTS);
    expect(markers[2].lon).toBe(-0.462);
    expect(markers[2].sizePx).toBeGreaterThan(markers[1].sizePx);
    expect(markers[1].sizePx).toBeGreaterThan(markers[0].sizePx);
    const [hubs] = airportLabels(AIRPORTS);
    expect(hubs.map((l) => l.text)).toEqual(['LHR · London', 'AUS · Austin', 'XYZ']);
    expect(airportLabelText({ iata: 'CDG', city: "Paris (Roissy-en-France, Val-d'Oise)", lon: 2.55, lat: 49.013, rank: 2 })).toBe('CDG · Paris');
  });

  it('lifts a route off the ground in the middle and lands it at both ends', () => {
    const out: number[] = [];
    const segments = routeArcSegments([-73.779, 40.64], [-0.462, 51.471], out);
    expect(out).toHaveLength(segments * 6);
    const start = new THREE.Vector3(out[0], out[1], out[2]);
    const end = new THREE.Vector3(...out.slice(-3));
    expect(start.length()).toBeCloseTo(EARTH_RADIUS_M, 0);
    expect(end.length()).toBeCloseTo(EARTH_RADIUS_M, 0);
    const groundM = start.angleTo(end) * EARTH_RADIUS_M;
    // New York to London is 5,540 km.
    expect(groundM / 1000).toBeGreaterThan(5500);
    expect(groundM / 1000).toBeLessThan(5600);
    let highest = 0;
    for (let i = 0; i < out.length; i += 3) highest = Math.max(highest, Math.hypot(out[i], out[i + 1], out[i + 2]) - EARTH_RADIUS_M);
    expect(highest).toBeGreaterThan(0.95 * ROUTE_PEAK_FRACTION * groundM);
    expect(highest).toBeLessThanOrEqual(ROUTE_PEAK_FRACTION * groundM + 1);
    // Consecutive segments join.
    expect(out.slice(3, 6)).toEqual(out.slice(6, 9));
  });

  it('draws nothing for a route from a place to itself', () => {
    const out: number[] = [];
    expect(routeArcSegments([10, 10], [10, 10], out)).toBe(0);
    expect(out).toHaveLength(0);
  });

  it('draws a route flown by more airlines brighter, with a colour per vertex', () => {
    expect(routeStrength(8)).toBe(1);
    expect(routeStrength(20)).toBe(1);
    expect(routeStrength(1)).toBeLessThan(routeStrength(4));
    const { positions, colors } = routeGeometry(ROUTES);
    expect(colors).toHaveLength(positions.length);
    expect(colors[0]).toBe(1);
    expect(colors[colors.length - 1]).toBeCloseTo(routeStrength(3));
  });
});

describe('shared helpers', () => {
  it('formats numbers and days the same in every locale', () => {
    expect(thousands(1592796)).toBe('1,592,796');
    expect(formatDay('2026-11-10')).toBe('10 Nov 2026');
  });

  it('splits a ranked list into the featured and the next', () => {
    expect(splitRanked([1, 2, 3, 4, 5], 2, 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('puts featured names ahead of the countries and the rest behind the states', () => {
    expect(FEATURED_RANK).toBeLessThan(0);
    expect(OTHER_RANK).toBeGreaterThan(FEATURED_RANK);
  });

  it('builds a legend of equal hard-edged bands', () => {
    expect(bandLegend([0xff0000, 0x00ff00])).toBe('linear-gradient(to right, #ff0000 0.0% 50.0%, #00ff00 50.0% 100.0%)');
  });
});

describe('the human-world layers', () => {
  it('are off until asked for, in known sections, each with a caption, a legend and a credit', () => {
    const ids = humanWorld.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const layer of humanWorld) {
      expect(layer.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(LAYER_SECTIONS).toContain(layer.section);
      expect(layer.defaultOn).toBeUndefined();
      expect(layer.caption).toBeTruthy();
      expect(layer.legend).toBeTruthy();
      expect(layer.credits.length).toBeGreaterThan(0);
      for (const credit of layer.credits) expect(credit.url).toMatch(/^https:\/\//);
    }
    expect(humanWorld.find((l) => l.id === 'rivers-lakes')?.section).toBe('Surface lines');
  });

  it('say plainly which data are restricted or old', () => {
    const byId = new Map(humanWorld.map((l) => [l.id, l]));
    expect(byId.get('undersea-cables')?.credits[0].licence).toContain('CC BY-NC-SA 3.0');
    expect(byId.get('undersea-cables')?.caption).toContain('not surveyed positions');
    expect(byId.get('air-routes')?.label).toContain('2014');
    expect(byId.get('air-routes')?.credits[0].licence).toContain('ODbL');
    expect(byId.get('air-routes')?.caption).toContain('not flight paths');
    expect(byId.get('power-plants')?.caption).toContain('2021');
  });

  it('use only symbols the marker renderer has', () => {
    for (const view of Object.values(SET_VIEWS)) {
      expect(MARKER_SHAPES).toContain(view.marker({ name: 'x', lon: 0, lat: 0, links: 1, value: 1 }).shape);
    }
  });
});
