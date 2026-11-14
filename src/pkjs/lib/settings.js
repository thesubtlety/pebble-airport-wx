'use strict';

/*
 * Settings: defaults, coercion and validation.
 *
 * Clay returns everything as strings or as {value: ...} wrappers, and the
 * user can type anything into a text field, so nothing that arrives from
 * configuration is trusted until it has been through here.
 */

var DEFAULT_API_BASE = 'https://aviationweather.gov/api/data/';

var DEFAULTS = {
  homeStation: '',
  stations: [],
  startPage: 0,

  flickNearest: true,
  /* Open on the nearest reporting station even with airports set.  With no
   * airport set, the app follows the nearest station whatever this says. */
  alwaysNearest: false,
  nearestRadiusNm: 50,
  nearestRevertMin: 10,

  runwayAuto: true,
  runwayManual: '',
  runwayCalm: '',
  calmKt: 5,

  altimUnit: 'inhg',
  tempUnit: 'f',
  visUnit: 'sm',
  ceilUnit: 'ft',

  maxWindKt: 0,
  maxGustKt: 0,
  maxXwKt: 0,
  minCigFt: 0,
  minVisSm: 0,

  refreshMin: 15,
  refreshOnOpen: true,
  staleAmberMin: 45,
  staleRedMin: 75,
  vibeOnCatChange: false,
  backlightOnFlick: true,

  tafPeriods: 4,
  showRawPage: true,

  apiBase: DEFAULT_API_BASE
};

var RANGES = {
  startPage: [0, 3],
  nearestRadiusNm: [10, 200],
  nearestRevertMin: [0, 60],
  calmKt: [0, 10],
  maxWindKt: [0, 99],
  maxGustKt: [0, 99],
  maxXwKt: [0, 99],
  minCigFt: [0, 10000],
  minVisSm: [0, 10],
  refreshMin: [5, 60],
  staleAmberMin: [15, 90],
  staleRedMin: [30, 180],
  tafPeriods: [2, 6]
};

var ENUMS = {
  altimUnit: ['inhg', 'hpa'],
  tempUnit: ['f', 'c'],
  visUnit: ['sm', 'km'],
  ceilUnit: ['ft', 'm']
};

var ICAO_RE = /^[A-Z][A-Z0-9]{3}$/;

/** Clay wraps some values as {value: x}; unwrap before anything else. */
function unwrap(v) {
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}

function toNumber(v, fallback) {
  v = unwrap(v);
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    var n = Number(v);
    if (isFinite(n)) return n;
  }
  return fallback;
}

function toBool(v, fallback) {
  v = unwrap(v);
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

function clamp(v, range) {
  return v < range[0] ? range[0] : (v > range[1] ? range[1] : v);
}

function validateIcao(s) {
  return typeof s === 'string' && ICAO_RE.test(s.trim().toUpperCase());
}

/**
 * Only https, and only a URL -- an API base arrives from a text field, and a
 * mistyped or hostile one would send every request somewhere unintended.
 */
function normaliseApiBase(v) {
  v = unwrap(v);
  if (typeof v !== 'string') return DEFAULT_API_BASE;
  var s = v.trim();
  if (!s) return DEFAULT_API_BASE;
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[^\s]*)?$/.test(s)) return DEFAULT_API_BASE;
  return s.charAt(s.length - 1) === '/' ? s : s + '/';
}

function normalise(raw) {
  raw = raw || {};
  var s = {};
  var key;

  for (key in DEFAULTS) {
    if (typeof DEFAULTS[key] === 'boolean') s[key] = toBool(raw[key], DEFAULTS[key]);
    else if (typeof DEFAULTS[key] === 'number') s[key] = Math.round(toNumber(raw[key], DEFAULTS[key]));
    else s[key] = DEFAULTS[key];
  }

  for (key in RANGES) s[key] = clamp(s[key], RANGES[key]);

  for (key in ENUMS) {
    var v = String(unwrap(raw[key]) || DEFAULTS[key]).toLowerCase();
    s[key] = ENUMS[key].indexOf(v) >= 0 ? v : DEFAULTS[key];
  }

  /* A red threshold at or below the amber one would mean the amber band never
   * appeared.  Push red out rather than dropping the setting on the floor. */
  if (s.staleRedMin <= s.staleAmberMin) s.staleRedMin = s.staleAmberMin + 15;

  s.homeStation = validateIcao(unwrap(raw.homeStation))
    ? String(unwrap(raw.homeStation)).trim().toUpperCase() : '';

  /* Clay has no list widget, so the extra stations arrive as station2..station5
   * alongside a stations array from anywhere else that builds settings. */
  var list = [];
  var candidates = [s.homeStation];
  for (var n = 2; n <= 5; n++) candidates.push(unwrap(raw['station' + n]));
  candidates = candidates.concat(unwrap(raw.stations) || []);
  for (var i = 0; i < candidates.length; i++) {
    var c = unwrap(candidates[i]);
    if (!validateIcao(c)) continue;
    var up = String(c).trim().toUpperCase();
    if (list.indexOf(up) < 0) list.push(up);
  }
  s.stations = list;

  s.runwayManual = String(unwrap(raw.runwayManual) || '').trim().toUpperCase();
  s.runwayCalm = String(unwrap(raw.runwayCalm) || '').trim().toUpperCase();
  s.apiBase = normaliseApiBase(raw.apiBase);

  return s;
}

module.exports = {
  normalise: normalise,
  validateIcao: validateIcao,
  DEFAULTS: DEFAULTS,
  DEFAULT_API_BASE: DEFAULT_API_BASE
};
