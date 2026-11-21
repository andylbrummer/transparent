/**
 * The Sun, Moon and planet positions a body target points at, on their own
 * so that targets.ts can load them when a body is first asked for. Imported
 * statically from anything the app loads at startup, they would put the
 * VSOP87 tables in the first load for everyone; the planets layer loads them
 * lazily the same way.
 */

export { moonGeocentricKm, planetEphemeris, sunGeocentricAu } from '@transparent-earth/core';
