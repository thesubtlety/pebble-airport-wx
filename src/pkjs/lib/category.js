'use strict';

/*
 * Flight category, derived per value.
 *
 * The app draws a category for visibility and a category for ceiling
 * independently, because the point of the design is to show which value is
 * limiting.  The API's own fltCat field gives one overall answer and so cannot
 * be used for that; we derive ours and keep the API's only as a cross-check.
 *
 * Thresholds are the US definitions (14 CFR 91.155 / the NWS convention).  The
 * app is US-only: ICAO practice differs, and applying these limits to a
 * non-US field would put a confidently wrong label on it.
 */

var VFR = 0;
var MVFR = 1;
var IFR = 2;
var LIFR = 3;
var UNKNOWN = 4;

var NAMES = ['VFR', 'MVFR', 'IFR', 'LIFR', '--'];

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/**
 * @param {?number} ft  Ceiling AGL in feet.  null means "no BKN/OVC/VV layer
 *   was reported", which is an unlimited ceiling, not a missing one.
 *   undefined/NaN mean we genuinely do not know.
 */
function ceilingCategory(ft) {
  if (ft === null) return VFR;
  if (!isNum(ft)) return UNKNOWN;
  if (ft < 500) return LIFR;
  if (ft < 1000) return IFR;
  if (ft <= 3000) return MVFR;
  return VFR;
}

/** @param {?number} sm  Visibility in statute miles. */
function visCategory(sm) {
  if (!isNum(sm)) return UNKNOWN;
  if (sm < 1) return LIFR;
  if (sm < 3) return IFR;
  if (sm <= 5) return MVFR;
  return VFR;
}

/**
 * The overall category is the worse of the two -- but an unknown value must
 * never mask a known bad one.  A missing ceiling alongside half-mile
 * visibility is still LIFR; only when we know nothing at all do we say so.
 */
function worst(a, b) {
  if (a === UNKNOWN && b === UNKNOWN) return UNKNOWN;
  if (a === UNKNOWN) return b;
  if (b === UNKNOWN) return a;
  return a > b ? a : b;
}

function name(c) {
  return NAMES[c] === undefined ? NAMES[UNKNOWN] : NAMES[c];
}

module.exports = {
  VFR: VFR,
  MVFR: MVFR,
  IFR: IFR,
  LIFR: LIFR,
  UNKNOWN: UNKNOWN,
  ceilingCategory: ceilingCategory,
  visCategory: visCategory,
  worst: worst,
  name: name
};
