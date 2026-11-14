'use strict';

/*
 * The AppMessage wire format.
 *
 * Two messages, kept small deliberately: an observation, and a TAF sent only
 * when the TAF page needs it.  Every value here is display-ready -- the watch
 * receives integers it can draw and strings it can print, and holds no opinion
 * about units, categories or trigonometry.
 */

var category = require('./category');

var ERR_NONE = 0;
var ERR_FETCHING = 1;
var ERR_NO_REPORT = 2;   /* HTTP 204: a valid request, nothing to report */
var ERR_API = 3;         /* transport or server error, including rate limiting */
var ERR_NO_GPS = 4;
var ERR_NO_STATION = 5;  /* nothing reporting inside the search radius */
/* No home airport has been set yet.  Distinct from ERR_NO_REPORT: one is the
 * app waiting to be told where you fly, the other is a real station that has
 * nothing to say. */
var ERR_NOT_CONFIGURED = 6;

/* KEY_XW_SIDE.  SIDE_NONE means "no component figure is available" -- either
 * there is no runway heading or the wind has no direction.  A bare magnitude
 * without a side would not tell the pilot which way to crab, and a fabricated
 * one would be worse. */
var SIDE_LEFT = 0;
var SIDE_RIGHT = 1;
var SIDE_NONE = 2;

var MAX_TAF_PERIODS = 6;

/* KEY_STATUS: what the phone is working on right now, as a bitmask.  The
 * watch draws its loading indicator while this is non-zero.  Every message the
 * controller sends carries the current mask, so the message that delivers a
 * result is also the one that takes the indicator down. */
var BUSY_OBS = 1;       /* an observation fetch */
var BUSY_TAF = 2;       /* a forecast fetch */
var BUSY_NEAREST = 4;   /* a GPS fix and area query */

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function clampInt(v, lo, hi, fallback) {
  if (!isNum(v)) return fallback;
  v = Math.round(v);
  return v < lo ? lo : (v > hi ? hi : v);
}

function str(v, max) {
  return String(v === null || v === undefined ? '' : v).slice(0, max);
}

function observationMessage(o, opts) {
  opts = opts || {};
  var hasComponents = isNum(o.hw) && isNum(o.xw) && o.xwSide;
  return {
    STATION: str(o.station, 4),
    IS_NEAREST: opts.isNearest ? 1 : 0,
    OBS_EPOCH: clampInt(o.obsEpoch, 0, 2147483647, 0),
    CAT_OVERALL: clampInt(o.catOverall, 0, 4, category.UNKNOWN),
    CAT_VIS: clampInt(o.catVis, 0, 4, category.UNKNOWN),
    CAT_CIG: clampInt(o.catCig, 0, 4, category.UNKNOWN),
    WIND_DIR: clampInt(o.windDir, -3, 359, -3),
    WIND_SPD: clampInt(o.windSpd, 0, 255, 0),
    WIND_GUST: clampInt(o.windGust, 0, 255, 0),
    VIS_STR: str(o.visStr, 7),
    CIG_STR: str(o.cigStr, 7),
    ALTIM_STR: str(o.altimStr, 7),
    TEMP_STR: str(o.tempStr, 9),
    RWY_IDENT: str(o.runway ? o.runway.ident : '', 4),
    RWY_HDG_TRUE: clampInt(o.runway ? o.runway.headingTrue : 0, 0, 359, 0),
    RWY_LEN_FT: clampInt(o.runway ? o.runway.lengthFt : 0, 0, 65535, 0),
    HW: hasComponents ? clampInt(o.hw, -128, 127, 0) : 0,
    XW: hasComponents ? clampInt(o.xw, 0, 127, 0) : 0,
    XW_SIDE: hasComponents ? (o.xwSide === 'R' ? SIDE_RIGHT : SIDE_LEFT) : SIDE_NONE,
    FLAGS: clampInt(o.flags, 0, 255, 0),
    RAW: str(o.raw, 167),
    ERROR: clampInt(opts.error, 0, 255, ERR_NONE)
  };
}

/**
 * A failure is a message, not silence.  The watch keeps showing whatever it
 * cached and overlays the state, so the pilot always knows what they are
 * looking at and how old it is.
 *
 * opts.nearest marks a failed nearest-station lookup.  That failure says
 * nothing about the reading on screen, so the watch shows it briefly and
 * leaves the reading alone rather than labelling it.
 */
function errorMessage(station, error, opts) {
  var d = {
    STATION: str(station, 4),
    ERROR: clampInt(error, 0, 255, ERR_API)
  };
  if (opts && opts.nearest) d.IS_NEAREST = 1;
  return d;
}

/**
 * @param {Object} f        From taf.build().
 * @param {string} station  The station the forecast is for.  The watch checks
 *   it against the station on screen, so a forecast can never be drawn under
 *   another airport's name.
 * @param {number=} error   ERR_NONE when the forecast (or its absence) is
 *   real; ERR_API when the fetch failed, so "no TAF published" and "could not
 *   get the TAF" read differently.
 */
function tafMessage(f, station, error) {
  var n = Math.min(f.periods.length, MAX_TAF_PERIODS);
  var d = {
    TAF_COUNT: n,
    TAF_STATION: str(station, 4),
    TAF_VALID: str(f.valid, 15),
    TAF_ISSUE: str(f.issue, 7),
    ERROR: clampInt(error, 0, 255, ERR_NONE)
  };
  for (var i = 0; i < n; i++) {
    var p = f.periods[i];
    d['TAF_TIME_' + i] = str(p.label, 5);
    d['TAF_CAT_' + i] = clampInt(p.category, 0, 4, category.UNKNOWN);
    d['TAF_TEXT_' + i] = str(p.text, 15);
    d['TAF_TEMPO_CAT_' + i] = clampInt(p.tempoCategory, 0, 4, category.UNKNOWN);
  }
  return d;
}

/**
 * Settings the watch needs in order to draw correctly before -- or without --
 * a successful fetch: the staleness thresholds, which page to open on, and
 * which inputs are live.
 */
function settingsMessage(s) {
  return {
    SET_STALE_AMBER: clampInt(s.staleAmberMin, 1, 240, 45),
    SET_STALE_RED: clampInt(s.staleRedMin, 1, 480, 75),
    SET_START_PAGE: clampInt(s.startPage, 0, 3, 0),
    SET_SHOW_RAW: s.showRawPage ? 1 : 0,
    SET_TAF_PERIODS: clampInt(s.tafPeriods, 2, MAX_TAF_PERIODS, 4),
    SET_FLICK_NEAREST: s.flickNearest ? 1 : 0,
    SET_BACKLIGHT_FLICK: s.backlightOnFlick ? 1 : 0,
    SET_VIBE_CAT_CHANGE: s.vibeOnCatChange ? 1 : 0,
    SET_STATION_COUNT: clampInt((s.stations || []).length, 0, 5, 0)
  };
}

function statusMessage(mask) {
  return { STATUS: clampInt(mask, 0, 255, 0) };
}

module.exports = {
  observationMessage: observationMessage,
  errorMessage: errorMessage,
  tafMessage: tafMessage,
  settingsMessage: settingsMessage,
  statusMessage: statusMessage,
  BUSY_OBS: BUSY_OBS,
  BUSY_TAF: BUSY_TAF,
  BUSY_NEAREST: BUSY_NEAREST,
  ERR_NONE: ERR_NONE,
  ERR_FETCHING: ERR_FETCHING,
  ERR_NO_REPORT: ERR_NO_REPORT,
  ERR_API: ERR_API,
  ERR_NO_GPS: ERR_NO_GPS,
  ERR_NO_STATION: ERR_NO_STATION,
  ERR_NOT_CONFIGURED: ERR_NOT_CONFIGURED,
  SIDE_LEFT: SIDE_LEFT,
  SIDE_RIGHT: SIDE_RIGHT,
  SIDE_NONE: SIDE_NONE,
  MAX_TAF_PERIODS: MAX_TAF_PERIODS
};
