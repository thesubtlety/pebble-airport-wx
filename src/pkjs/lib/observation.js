'use strict';

/*
 * AWC METAR JSON -> the display-ready observation the watch renders.
 *
 * The watch never parses a raw METAR.  Everything -- unit conversion, ceiling
 * extraction, category derivation, wind trigonometry, personal minima -- is
 * settled here, so the watch spends its RAM on drawing and a bug in the
 * arithmetic is fixed by reinstalling the phone side.
 */

var units = require('./units');
var category = require('./category');
var windLib = require('./wind');
var runways = require('./runways');

/* Sentinel values for the int16 KEY_WIND_DIR field. */
var WIND_VRB = -1;
var WIND_CALM = -2;
var WIND_MISSING = -3;

/* KEY_FLAGS bitfield.  These are personal-minima flags only; the regulatory
 * category travels in its own fields. */
var FLAG_WIND = 1;
var FLAG_XW = 2;
var FLAG_GUST = 4;
var FLAG_CIG = 8;
var FLAG_VIS = 16;
var FLAG_XW_GUST = 32;

var RAW_MAX = 167; /* KEY_RAW is cstring[168], one byte of which is the NUL. */
var RAW_CUT = ' ...';

/*
 * The raw report, cut to fit the watch's field.  A report longer than that is
 * cut at a group boundary and marked, never mid-group: "SLP124" clipped to "S"
 * reads as a group of its own, the same trap the TAF strip avoids by dropping
 * whole tokens.  Reports this long are rare (thunderstorm remarks) but real.
 */
function fitRaw(raw) {
  raw = String(raw || '');
  if (raw.length <= RAW_MAX) return raw;
  var room = RAW_MAX - RAW_CUT.length;
  var cut = raw.lastIndexOf(' ', room);
  return (cut > 0 ? raw.slice(0, cut) : raw.slice(0, room)) + RAW_CUT;
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/**
 * Ceiling is the base of the lowest BKN or OVC layer, or the vertical
 * visibility when the sky is obscured.  FEW and SCT are not ceilings.
 *
 * @return {{ft: ?number, isVv: boolean}} ft === null means unlimited;
 *   ft === undefined means we could not tell.
 */
function ceilingOf(clouds) {
  if (!clouds || !clouds.length) {
    /* An empty array is a real report of a clear sky.  A missing one is not. */
    return { ft: clouds ? null : undefined, isVv: false };
  }
  var best = null;
  /* A broken or overcast layer whose height was not reported ("BKN///") is
   * still a ceiling.  If it is the lowest such layer, the ceiling is unknown
   * -- not unlimited, which is what skipping it used to produce. */
  var unknownLowest = false;
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i] || {};
    var cover = String(c.cover || '').toUpperCase();
    var base = isNum(c.base) ? c.base : null;
    if (cover === 'OVX' || cover === 'VV') {
      /* An obscured sky: the figure is a vertical visibility.  If the height
       * is missing the sky is still obscured, which is at worst LIFR. */
      return { ft: base === null ? 0 : base, isVv: true };
    }
    if (cover === 'BKN' || cover === 'OVC') {
      /* Layers are reported lowest first, so an unknown one seen before any
       * known one is below it. */
      if (base === null) {
        if (best === null) unknownLowest = true;
      } else if (best === null || base < best) {
        best = base;
      }
    }
  }
  if (unknownLowest) return { ft: undefined, isVv: false };
  return { ft: best, isVv: false };
}

function normaliseWind(wdir, wspd) {
  if (!isNum(wspd)) return { dir: WIND_MISSING, spd: 0 };
  if (wspd === 0) return { dir: WIND_CALM, spd: 0 };
  if (typeof wdir === 'string' && wdir.toUpperCase().indexOf('VRB') >= 0) {
    return { dir: WIND_VRB, spd: Math.round(wspd) };
  }
  if (!isNum(wdir)) return { dir: WIND_MISSING, spd: Math.round(wspd) };
  var d = Math.round(wdir) % 360;
  if (d < 0) d += 360;
  return { dir: d, spd: Math.round(wspd) };
}

function overLimit(value, limit) {
  return isNum(limit) && limit > 0 && isNum(value) && value > limit;
}

function underLimit(value, limit) {
  return isNum(limit) && limit > 0 && isNum(value) && value < limit;
}

/**
 * @param {Object} m         One element of the AWC METAR JSON array.
 * @param {Object} s         The settings object.
 * @param {boolean=} isNearest
 */
function build(m, s) {
  m = m || {};
  s = s || {};

  var station = String(m.icaoId || '----').toUpperCase();
  var visSm = units.parseVisibility(m.visib);
  var ceil = ceilingOf(m.clouds);
  var w = normaliseWind(m.wdir, m.wspd);
  var gust = isNum(m.wgst) ? Math.round(m.wgst) : 0;

  var catVis = category.visCategory(visSm);
  var catCig = category.ceilingCategory(ceil.ft === undefined ? undefined : ceil.ft);

  var o = {
    station: station,
    obsEpoch: isNum(m.obsTime) ? m.obsTime : 0,
    lat: isNum(m.lat) ? m.lat : null,
    lon: isNum(m.lon) ? m.lon : null,
    windDir: w.dir,
    windSpd: w.spd,
    windGust: gust,
    visSm: visSm,
    ceilingFt: ceil.ft === undefined ? undefined : ceil.ft,
    ceilingIsVv: ceil.isVv,
    catVis: catVis,
    catCig: catCig,
    catOverall: category.worst(catVis, catCig),
    visStr: units.formatVisibility(visSm, s.visUnit),
    cigStr: units.formatCeiling(ceil.ft === undefined ? undefined : ceil.ft,
                                ceil.isVv, s.ceilUnit),
    altimStr: units.formatAltimeter(isNum(m.altim) ? m.altim : null, s.altimUnit),
    tempStr: units.formatTemp(isNum(m.temp) ? m.temp : null,
                              isNum(m.dewp) ? m.dewp : null, s.tempUnit),
    raw: fitRaw(m.rawOb),
    apiCategory: m.fltCat || null,
    runway: null,
    hw: null,
    xw: null,
    xwSide: null,
    xwGust: null,
    flags: 0
  };

  var dirTrue = w.dir >= 0 ? w.dir : null;
  o.runway = windLib.selectRunway(runways.lookup(station), dirTrue, o.windSpd, {
    calmKt: s.calmKt,
    manual: s.runwayAuto === false ? s.runwayManual : null,
    calmRunway: s.runwayCalm
  });

  if (o.runway) {
    var c = windLib.components(dirTrue, o.windSpd, o.runway.headingTrue);
    if (c) {
      o.hw = c.headwind;
      o.xw = c.crosswind;
      o.xwSide = c.side;
    }
    if (gust) {
      var g = windLib.components(dirTrue, gust, o.runway.headingTrue);
      if (g) o.xwGust = g.crosswind;
    }
  }

  var flags = 0;
  if (overLimit(o.windSpd, s.maxWindKt)) flags |= FLAG_WIND;
  if (overLimit(gust, s.maxGustKt)) flags |= FLAG_GUST;
  if (overLimit(o.xw, s.maxXwKt)) flags |= FLAG_XW;
  if (overLimit(o.xwGust, s.maxXwKt)) flags |= FLAG_XW_GUST;
  /* An unlimited ceiling is not a low one; only a reported height can be. */
  if (isNum(o.ceilingFt) && underLimit(o.ceilingFt, s.minCigFt)) flags |= FLAG_CIG;
  if (underLimit(visSm, s.minVisSm)) flags |= FLAG_VIS;
  o.flags = flags;

  return o;
}

/**
 * A one-line summary of the observation, for the NOW row of the TAF strip.
 * Same shape as a forecast row's conditions, so the column reads consistently
 * from observed reality into forecast.
 */
function summaryText(o) {
  var vis = o.visStr && o.visStr !== '--' ? o.visStr : '';
  var cig = o.cigStr && o.cigStr !== '--' ? o.cigStr : '';
  /* Same rule as the forecast rows: drop a whole value rather than clip one,
   * because a truncated ceiling reads as a plausible wrong number. */
  var candidates = [[vis, cig], [cig], [vis]];
  for (var i = 0; i < candidates.length; i++) {
    var text = candidates[i].filter(Boolean).join(' ');
    if (text && text.length <= 15) return text;
  }
  return '';
}

module.exports = {
  build: build,
  fitRaw: fitRaw,
  summaryText: summaryText,
  ceilingOf: ceilingOf,
  WIND_VRB: WIND_VRB,
  WIND_CALM: WIND_CALM,
  WIND_MISSING: WIND_MISSING,
  FLAG_WIND: FLAG_WIND,
  FLAG_XW: FLAG_XW,
  FLAG_GUST: FLAG_GUST,
  FLAG_CIG: FLAG_CIG,
  FLAG_VIS: FLAG_VIS,
  FLAG_XW_GUST: FLAG_XW_GUST,
  RAW_MAX: RAW_MAX
};
