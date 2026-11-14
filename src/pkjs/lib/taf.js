'use strict';

/*
 * AWC TAF JSON -> the four-to-six row forecast strip the watch draws.
 *
 * Two rules shape this file:
 *
 *  - Row 0 is NOW and takes its category from the observation, not the TAF, so
 *    the colour column starts from observed reality rather than from what was
 *    forecast three hours ago.
 *  - A TEMPO or PROB group is not a period.  Rendering one as a row would say
 *    the weather *becomes* that, when the forecaster said it *might briefly*.
 *    Groups ride inside their parent row instead, and the row label gets an
 *    asterisk so the information survives without colour.
 */

var units = require('./units');
var category = require('./category');

/* A period with less than this long to run is not worth one of four rows. */
var MIN_REMAINING_S = 20 * 60;

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function hourLabel(epoch) {
  return pad2(new Date(epoch * 1000).getUTCHours()) + 'Z';
}

function dayHour(epoch) {
  var d = new Date(epoch * 1000);
  return pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + 'Z';
}

/** The lowest layer of any cover, as a pilot writes it: BKN008, SCT040, VV002. */
function layerText(f) {
  if (isNum(f.vertVis)) return 'VV' + pad3(Math.round(f.vertVis / 100));
  var clouds = f.clouds || [];
  var best = null;
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i] || {};
    var cover = String(c.cover || '').toUpperCase();
    if (cover === 'OVX' || cover === 'VV') {
      return 'VV' + pad3(Math.round((isNum(c.base) ? c.base : 0) / 100));
    }
    if (!isNum(c.base) || cover === 'CLR' || cover === 'SKC' || cover === 'CAVOK') continue;
    if (!best || c.base < best.base) best = { cover: cover, base: c.base };
  }
  return best ? best.cover + pad3(Math.round(best.base / 100)) : '';
}

function pad3(n) {
  return (n < 100 ? '0' : '') + (n < 10 ? '0' : '') + n;
}

/** Ceiling for category purposes: BKN/OVC/VV only, as on the observation side. */
function ceilingOf(f) {
  if (isNum(f.vertVis)) return { ft: f.vertVis, isVv: true };
  var clouds = f.clouds || [];
  var best = null;
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i] || {};
    var cover = String(c.cover || '').toUpperCase();
    if (cover === 'OVX' || cover === 'VV') return { ft: isNum(c.base) ? c.base : 0, isVv: true };
    if ((cover === 'BKN' || cover === 'OVC') && isNum(c.base)) {
      if (best === null || c.base < best) best = c.base;
    }
  }
  return { ft: best, isVv: false };
}

function categoryOf(f) {
  var vis = units.parseVisibility(f.visib);
  var ceil = ceilingOf(f);
  return category.worst(category.visCategory(vis), category.ceilingCategory(ceil.ft));
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== '';
}

/*
 * A TEMPO or PROB group lists only what changes.  "TEMPO 1215/1218 -TSRA"
 * keeps the base period's visibility and clouds, so a group that omits an
 * element inherits it.  Judged on its own, that group has no visibility and no
 * cloud layer and came out VFR -- a green bar on a thunderstorm.
 */
function groupWithParent(grp, parent) {
  var hasSky = (grp.clouds && grp.clouds.length) || isNum(grp.vertVis);
  return {
    visib: hasValue(grp.visib) ? grp.visib : parent.visib,
    clouds: hasSky ? grp.clouds : parent.clouds,
    vertVis: hasSky ? grp.vertVis : parent.vertVis
  };
}

/* TAF visibility of "6+" is P6SM on the page and in the pilot's head. */
function visText(v) {
  if (typeof v === 'string' && v.indexOf('+') >= 0) {
    var n = units.parseVisibility(v);
    return n === null ? '' : 'P' + units.formatVisibility(n, 'sm');
  }
  var sm = units.parseVisibility(v);
  return sm === null ? '' : units.formatVisibility(sm, 'sm');
}

var TEXT_MAX = 15;

/*
 * Assemble the condition summary, dropping whole tokens when it will not fit.
 *
 * Never truncate mid-token.  "P6SM VCSH SCT020" is one byte over the field and
 * slicing it gives "P6SM VCSH SCT02", which reads as a 200 ft base instead of
 * 2,000 ft.  A dropped weather group costs the pilot some context; a clipped
 * cloud base gives them a wrong number that looks like a right one.
 *
 * Priority, least important first: the weather string goes, then visibility.
 * The cloud layer is last to go because it is the ceiling.
 */
function conditionText(f) {
  var vis = visText(f.visib);
  var wx = f.wxString ? String(f.wxString).trim() : '';
  var layer = layerText(f);

  var candidates = [
    [vis, wx, layer],
    [vis, layer],
    [layer],
    [vis]
  ];
  for (var i = 0; i < candidates.length; i++) {
    var text = candidates[i].filter(Boolean).join(' ');
    if (text && text.length <= TEXT_MAX) return text;
  }
  /* Nothing fits whole -- rather than emit a misleading fragment, say nothing. */
  return '';
}

function isGroup(f) {
  var ch = String(f.fcstChange || '').toUpperCase();
  return ch.indexOf('TEMPO') >= 0 || ch.indexOf('PROB') >= 0 || isNum(f.probability);
}

/**
 * @param {?Object} json One element of the AWC TAF JSON array.
 * @param {Object} opts  {periods, now, nowCategory}
 */
function build(json, opts) {
  opts = opts || {};
  var now = isNum(opts.now) ? opts.now : Math.floor(Date.now() / 1000);
  var want = isNum(opts.periods) ? opts.periods : 4;
  var nowCat = isNum(opts.nowCategory) ? opts.nowCategory : category.UNKNOWN;
  /* The NOW row shows what is being observed, so it needs the observation's
   * own summary rather than a forecast one. */
  var nowText = nowCat === category.UNKNOWN ? '' : String(opts.nowText || '').slice(0, 15);

  var out = {
    issue: '',
    valid: '',
    periods: [{
      label: 'NOW',
      text: nowText,
      category: nowCat,
      tempoCategory: category.UNKNOWN,
      from: now
    }]
  };
  if (!json) return out;

  if (json.issueTime) {
    var t = Date.parse(json.issueTime);
    if (!isNaN(t)) {
      var d = new Date(t);
      out.issue = pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + 'Z';
    }
  }
  if (isNum(json.validTimeFrom) && isNum(json.validTimeTo)) {
    out.valid = dayHour(json.validTimeFrom) + '-' + dayHour(json.validTimeTo);
  }

  var fcsts = json.fcsts || [];
  var bases = [], groups = [];
  for (var i = 0; i < fcsts.length; i++) {
    (isGroup(fcsts[i]) ? groups : bases).push(fcsts[i]);
  }
  bases.sort(function (a, b) { return a.timeFrom - b.timeFrom; });

  for (var j = 0; j < bases.length && out.periods.length < want; j++) {
    var f = bases[j];
    if (!isNum(f.timeFrom)) continue;
    if (isNum(f.timeTo) && f.timeTo - now < MIN_REMAINING_S) continue;

    var period = {
      label: hourLabel(f.timeFrom),
      text: conditionText(f),
      category: categoryOf(f),
      tempoCategory: category.UNKNOWN,
      from: f.timeFrom
    };

    /* Attach every group in effect during this period -- including one that
     * began in an earlier period and runs into this one, which a "starts
     * inside" test missed.  A group that has already ended is history. */
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      if (!isNum(grp.timeFrom)) continue;
      if (isNum(f.timeTo) && grp.timeFrom >= f.timeTo) continue;
      if (isNum(grp.timeTo) && (grp.timeTo <= f.timeFrom || grp.timeTo <= now)) continue;
      period.tempoCategory = category.worst(period.tempoCategory,
                                            categoryOf(groupWithParent(grp, f)));
    }
    if (period.tempoCategory !== category.UNKNOWN) period.label += '*';

    out.periods.push(period);
  }

  return out;
}

module.exports = { build: build, MIN_REMAINING_S: MIN_REMAINING_S };
