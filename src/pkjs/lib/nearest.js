'use strict';

/*
 * Nearest reporting station.
 *
 * "Nearest" means the nearest station with a *current* report, not the nearest
 * airport -- an airport with no observation tells the pilot nothing, and a
 * three-hour-old one is worse than nothing because it looks current.
 * Reports older than 90 minutes are dropped before the distance comparison,
 * and stations with no runway data are still eligible: the weather is the
 * point.
 */

var NM_PER_DEG_LAT = 60;
var EARTH_R_NM = 3440.065;

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function rad(d) { return d * Math.PI / 180; }

function distanceNm(lat1, lon1, lat2, lon2) {
  var p1 = rad(lat1), p2 = rad(lat2);
  var dp = rad(lat2 - lat1), dl = rad(lon2 - lon1);
  var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
          Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * EARTH_R_NM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function boundingBox(lat, lon, radiusNm) {
  var dLat = radiusNm / NM_PER_DEG_LAT;
  /* Longitude degrees shrink towards the poles; guard the cosine so a fix near
   * the pole does not ask for an infinitely wide box. */
  var cos = Math.cos(rad(clamp(lat, -89.5, 89.5)));
  var dLon = radiusNm / (NM_PER_DEG_LAT * Math.max(cos, 0.02));
  return {
    minLat: clamp(lat - dLat, -90, 90),
    minLon: clamp(lon - dLon, -180, 180),
    maxLat: clamp(lat + dLat, -90, 90),
    maxLon: clamp(lon + dLon, -180, 180)
  };
}

/** The API wants bbox=minlat,minlon,maxlat,maxlon. */
function bboxParam(lat, lon, radiusNm) {
  var b = boundingBox(lat, lon, radiusNm);
  return [b.minLat, b.minLon, b.maxLat, b.maxLon].map(function (v) {
    return v.toFixed(3);
  }).join(',');
}

/**
 * @param {?Array} list   Raw METAR JSON entries from the area query.
 * @param {Object} opts   {now, maxAgeS, radiusNm}
 * @return {?Object} The raw entry, with a `distanceNm` added.
 */
function pick(list, lat, lon, opts) {
  if (!list || !list.length || !isNum(lat) || !isNum(lon)) return null;
  opts = opts || {};
  var now = isNum(opts.now) ? opts.now : Math.floor(Date.now() / 1000);
  var maxAge = isNum(opts.maxAgeS) ? opts.maxAgeS : 5400;
  var radius = isNum(opts.radiusNm) ? opts.radiusNm : 50;

  var best = null, bestD = Infinity;
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s || !isNum(s.lat) || !isNum(s.lon)) continue;
    if (!isNum(s.obsTime) || now - s.obsTime > maxAge) continue;
    /* The API searched a box; the user asked for a radius. */
    var d = distanceNm(lat, lon, s.lat, s.lon);
    if (d > radius) continue;
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return null;
  best.distanceNm = Math.round(bestD);
  return best;
}

module.exports = {
  distanceNm: distanceNm,
  boundingBox: boundingBox,
  bboxParam: bboxParam,
  pick: pick
};
