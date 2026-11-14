'use strict';

/*
 * Wind geometry and runway selection.
 *
 * Everything here is in degrees TRUE.  METAR wind direction is true; runway
 * numbers painted on the pavement are magnetic.  Mixing the two silently
 * introduces an error equal to the local magnetic variation -- around 10
 * degrees over much of the US, which is several knots of crosswind.  The
 * bundled runway table therefore stores true headings, and the runway *label*
 * is the only magnetic thing on the screen.
 */

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

/** Signed difference a - b, normalised into (-180, 180]. */
function angleDiff(a, b) {
  var d = (a - b) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

function roundHalfAway(v) {
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

/**
 * Head- and crosswind components for a wind against a runway heading.
 * Returns null when any operand is missing: a component figure computed from
 * an assumed heading is worse than no figure at all.
 */
function components(windDirTrue, windSpeedKt, runwayHeadingTrue) {
  if (!isNum(windDirTrue) || !isNum(windSpeedKt) || !isNum(runwayHeadingTrue)) return null;
  var d = angleDiff(windDirTrue, runwayHeadingTrue);
  var rad = d * Math.PI / 180;
  return {
    delta: d,
    headwind: roundHalfAway(windSpeedKt * Math.cos(rad)),
    crosswind: roundHalfAway(Math.abs(windSpeedKt * Math.sin(rad))),
    side: d > 0 ? 'R' : 'L'
  };
}

function endsOf(rwy) {
  return [
    { ident: rwy.le, headingTrue: rwy.hdg % 360, lengthFt: rwy.len },
    { ident: rwy.he, headingTrue: (rwy.hdg + 180) % 360, lengthFt: rwy.len }
  ];
}

function identNumber(ident) {
  var m = /^(\d{1,2})/.exec(ident || '');
  return m ? Number(m[1]) : 99;
}

/**
 * Pick the runway end the wind favours.
 *
 * This is a heuristic, and it is right most of the time but not always -- ATC
 * runs the opposite flow for noise abatement and traffic reasons.  The display
 * labels the result "RWY 23R" and never "in use" or "active": the app has not
 * heard the ATIS and must not imply that it has.
 *
 * @param {Array}   runways  Table entries, longest first.
 * @param {?number} windDir  Degrees true, or null for VRB/calm/missing.
 * @param {?number} windSpd  Knots.
 * @param {Object}  opts     {calmKt, manual, calmRunway}
 */
function selectRunway(runways, windDir, windSpd, opts) {
  if (!runways || !runways.length) return null;
  opts = opts || {};

  if (opts.manual) {
    var want = String(opts.manual).toUpperCase().replace(/^0*(\d)/, '$1');
    for (var i = 0; i < runways.length; i++) {
      var ends = endsOf(runways[i]);
      for (var j = 0; j < 2; j++) {
        if (ends[j].ident.replace(/^0*(\d)/, '$1') === want) return ends[j];
      }
    }
    /* Configured for another airport.  Fall through to the heuristic rather
     * than showing a runway this field does not have. */
  }

  var longest = runways[0];
  for (var k = 1; k < runways.length; k++) {
    if (runways[k].len > longest.len) longest = runways[k];
  }

  var calm = !isNum(windDir) || !isNum(windSpd) || windSpd < (isNum(opts.calmKt) ? opts.calmKt : 5);
  var candidates = endsOf(longest);

  if (calm) {
    if (opts.calmRunway) {
      var calmPick = selectRunway(runways, null, null, { manual: opts.calmRunway });
      if (calmPick) return calmPick;
    }
    return identNumber(candidates[0].ident) <= identNumber(candidates[1].ident)
      ? candidates[0] : candidates[1];
  }

  return Math.abs(angleDiff(windDir, candidates[0].headingTrue)) <= 90
    ? candidates[0] : candidates[1];
}

module.exports = {
  angleDiff: angleDiff,
  components: components,
  selectRunway: selectRunway
};
