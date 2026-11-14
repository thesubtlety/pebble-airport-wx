'use strict';

/*
 * Unit conversion and display formatting.
 *
 * All of it lives here, on the phone, so the watch receives display-ready
 * strings and never needs to know the user's unit preferences.  The byte
 * budgets in the tests are the AppMessage cstring sizes from the protocol.
 */

var HPA_TO_INHG = 0.029530;
var SM_TO_KM = 1.609344;
var FT_TO_M = 0.3048;

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/* Math.round(-5.5) is -5 in JavaScript, which drops half a degree in the wrong
 * direction below freezing.  Round away from zero instead. */
function roundHalfAway(v) {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/**
 * The visib field is a number on some reports and the string "10+" or "6+" on
 * others.  Anything arithmetic downstream must go through here first.
 */
function parseVisibility(v) {
  if (isNum(v)) return v;
  if (typeof v !== 'string') return null;
  /* "M1/4" is "less than a quarter" and "P6" is "more than six": the value is
   * the bound, which is what the category and the display both want. */
  var s = v.trim().replace('+', '').replace(/^[MP]/, '').replace(/SM$/, '').trim();
  if (!s) return null;
  var mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  var frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  var n = Number(s);
  return isFinite(n) && s.match(/\d/) ? n : null;
}

function formatAltimeter(hpa, unit) {
  if (!isNum(hpa)) return '--';
  if (unit === 'hpa') return String(Math.round(hpa));
  return (hpa * HPA_TO_INHG).toFixed(2);
}

function formatTemp(tempC, dewpC, unit) {
  if (!isNum(tempC) || !isNum(dewpC)) return '--';
  var t = tempC, d = dewpC, suffix = 'C';
  if (unit === 'f') {
    t = tempC * 9 / 5 + 32;
    d = dewpC * 9 / 5 + 32;
    suffix = 'F';
  }
  return roundHalfAway(t) + '/' + roundHalfAway(d) + suffix;
}

function gcd(a, b) {
  while (b) {
    var t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/*
 * Statute-mile visibility below 3 is read as a fraction, not as 0.75, and in
 * the steps it is reported in: sixteenths below 3/8, eighths below 2, quarters
 * below 3.  Rounding everything to quarters turned 1/8 into "1/4" and 1 3/8
 * into "1 1/2" -- a better number than was reported.
 *
 * Values between steps round *down*, so the display is never better than the
 * report.  The small epsilon keeps 0.375 (3/8) from flooring to 5/16 on a
 * floating-point hair.
 */
function fractionSm(sm) {
  var step = sm < 0.375 ? 16 : (sm < 2 ? 8 : 4);
  var parts = Math.floor(sm * step + 1e-6);
  var whole = Math.floor(parts / step);
  var rem = parts % step;
  if (rem === 0) return String(whole);
  var g = gcd(rem, step);
  var frac = (rem / g) + '/' + (step / g);
  return whole ? whole + ' ' + frac : frac;
}

function formatVisibility(sm, unit) {
  if (!isNum(sm)) return '--';
  if (unit === 'km') {
    var km = sm * SM_TO_KM;
    return (km < 5 ? String(Math.round(km * 10) / 10) : String(Math.round(km))) + 'KM';
  }
  return (sm < 3 ? fractionSm(sm) : String(Math.round(sm * 10) / 10)) + 'SM';
}

/**
 * @param {?number} ft   Ceiling AGL in feet, or null for "no ceiling layer".
 * @param {boolean} isVv True when the figure is a vertical visibility rather
 *   than a cloud base -- an obscured sky is a materially different situation
 *   and the display should not flatten the two together.
 */
function formatCeiling(ft, isVv, unit) {
  if (ft === null) return 'UNL';
  if (!isNum(ft)) return '--';
  var value = unit === 'm' ? Math.round(ft * FT_TO_M / 10) * 10 + 'M' : String(Math.round(ft));
  return isVv ? 'VV' + value : value;
}

module.exports = {
  HPA_TO_INHG: HPA_TO_INHG,
  roundHalfAway: roundHalfAway,
  parseVisibility: parseVisibility,
  formatAltimeter: formatAltimeter,
  formatTemp: formatTemp,
  formatVisibility: formatVisibility,
  formatCeiling: formatCeiling
};
