import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ageFromLocation, formatMa } from './continents';
import { crustAt, parsePlateFile, reconstructPoint } from './plates-data';
import { describeAge, type TimeScale } from './timescale';
import { advancePlay, snapValue } from './time-control';

/** The baked files themselves: what the layer will read. */
const file = readFileSync('public/geo/deep-time/plates.bin');
const model = parsePlateFile(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
const scale = JSON.parse(new TextDecoder().decode(readFileSync('public/geo/deep-time/timescale.json'))) as TimeScale;

function placeAt(lon: number, lat: number, ageMa: number): { lon: number; lat: number } {
  const crust = crustAt(model, lon, lat);
  expect(crust).not.toBeNull();
  return reconstructPoint(model, crust!.plate, lon, lat, ageMa);
}

describe('the baked plate model', () => {
  it('covers a billion years', () => {
    expect(model.header.maxAgeMa).toBe(1000);
  });

  it('leaves every place where it is today', () => {
    for (const [lon, lat] of [
      [-97.74, 30.27],
      [77.21, 28.61],
      [36.82, -1.29],
    ]) {
      const now = placeAt(lon, lat, 0);
      expect(now.lon).toBeCloseTo(lon, 3);
      expect(now.lat).toBeCloseTo(lat, 3);
    }
  });

  it('has India far south of the equator in the latest Cretaceous, running north since', () => {
    // Delhi: the Indian plate's northward flight is the model's best-known motion.
    const at71 = placeAt(77.21, 28.61, 71).lat;
    const at40 = placeAt(77.21, 28.61, 40).lat;
    expect(at71).toBeLessThan(-10);
    expect(at40).toBeGreaterThan(at71);
    expect(at40).toBeLessThan(28.61);
  });

  it('closes the South Atlantic: Brazil’s corner lies against the Gulf of Guinea in the Jurassic', () => {
    // Inland of Recife and of Douala, so both stand on the model's land.
    const recife = placeAt(-37.0, -7.0, 150);
    const douala = placeAt(11.0, 4.5, 150);
    const toRad = Math.PI / 180;
    const cos =
      Math.sin(recife.lat * toRad) * Math.sin(douala.lat * toRad) +
      Math.cos(recife.lat * toRad) * Math.cos(douala.lat * toRad) * Math.cos((recife.lon - douala.lon) * toRad);
    const apartDeg = Math.acos(Math.min(1, cos)) / toRad;
    // 45° of ocean lie between them today.
    expect(apartDeg).toBeLessThan(10);
  });

  it('finds no continental crust in mid-ocean', () => {
    expect(crustAt(model, -140, 0)).toBeNull();
  });
});

describe('the time control’s arithmetic and wording', () => {
  it('reads ?ma= and keeps it inside the model', () => {
    expect(ageFromLocation('?ma=100', 1000)).toBe(100);
    expect(ageFromLocation('?ma=5000', 1000)).toBe(1000);
    expect(ageFromLocation('?ma=-3', 1000)).toBe(0);
    expect(ageFromLocation('?ma=soon', 1000)).toBe(0);
    expect(ageFromLocation('', 1000)).toBe(0);
  });

  it('names the period an age falls in', () => {
    expect(describeAge(scale, 150)).toContain('Jurassic');
    expect(describeAge(scale, 100)).toContain('Cretaceous');
    expect(describeAge(scale, 300)).toContain('Carboniferous');
  });

  it('writes ages in Ma and snaps and plays within range', () => {
    expect(formatMa(0)).toBe('0 Ma');
    expect(snapValue(103, 5, 1000) % 5).toBe(0);
    expect(snapValue(2000, 5, 1000)).toBe(1000);
    expect(advancePlay(10, 1000, 20)).not.toBe(10);
  });
});
