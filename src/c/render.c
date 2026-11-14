#include "avwx.h"

/*
 * Drawing helpers.
 *
 * The two-encoding rule lives here, in draw_value(), and nowhere else:
 *
 *   a filled colour block behind a value  = that value's regulatory category
 *                                           is below VFR
 *   amber text                            = that value is past a limit the
 *                                           user set in settings
 *
 * Only ceiling and visibility can carry a block, because only they determine
 * the category.  Wind never does: colouring it green would say wind affects
 * flight category, which it does not.
 */

GColor cat_color(uint8_t cat) {
  switch (cat) {
    case CAT_VFR:  return GColorGreen;
    case CAT_MVFR: return GColorPictonBlue;
    case CAT_IFR:  return GColorRed;
    case CAT_LIFR: return GColorMagenta;
    default:       return GColorDarkGray;
  }
}

/* Black reads well on green and picton blue.  On red and magenta it does not,
 * so those take white. */
GColor cat_text_color(uint8_t cat) {
  switch (cat) {
    case CAT_VFR:
    case CAT_MVFR: return GColorBlack;
    default:       return GColorWhite;
  }
}

const char *cat_name(uint8_t cat) {
  switch (cat) {
    case CAT_VFR:  return "VFR";
    case CAT_MVFR: return "MVFR";
    case CAT_IFR:  return "IFR";
    case CAT_LIFR: return "LIFR";
    default:       return "--";
  }
}

/* Age is computed on the watch from the observation time, so it keeps counting
 * up correctly with the phone out of range -- which is exactly when knowing
 * how old the reading is matters most. */
int32_t obs_age_minutes(void) {
  const AppState *s = state();
  if (!s->obs.have_data || s->obs.obs_epoch <= 0) return -1;
  int32_t age = (int32_t)((time(NULL) - (time_t)s->obs.obs_epoch) / 60);
  return age < 0 ? 0 : age;
}

GColor age_color(int32_t age_minutes) {
  const Settings *set = &state()->settings;
  if (age_minutes < 0) return GColorLightGray;
  if (age_minutes >= set->stale_red_min) return GColorRed;
  if (age_minutes >= set->stale_amber_min) return GColorChromeYellow;
  return GColorLightGray;
}

void format_age(char *out, size_t len, int32_t minutes) {
  if (minutes < 0) {
    snprintf(out, len, "--");
  } else if (minutes < 100) {
    snprintf(out, len, "%dm", (int)minutes);
  } else {
    snprintf(out, len, "%dh%02dm", (int)(minutes / 60), (int)(minutes % 60));
  }
}

void format_length_ft(char *out, size_t len, uint16_t feet) {
  if (feet >= 1000) {
    snprintf(out, len, "%d,%03d", feet / 1000, feet % 1000);
  } else {
    snprintf(out, len, "%d", feet);
  }
}

/*
 * The wind string.  Built here rather than on the phone because the watch
 * already has the numbers and the string has to change size to fit.
 */
void format_wind(char *out, size_t len, const Observation *obs) {
  if (obs->wind_dir == WIND_DIR_CALM) {
    snprintf(out, len, "CALM");
  } else if (obs->wind_dir == WIND_DIR_MISSING) {
    snprintf(out, len, "--");
  } else if (obs->wind_dir == WIND_DIR_VRB) {
    if (obs->wind_gust) snprintf(out, len, "VRB%dG%d", obs->wind_spd, obs->wind_gust);
    else snprintf(out, len, "VRB%d", obs->wind_spd);
  } else if (obs->wind_gust) {
    snprintf(out, len, "%03d/%dG%d", obs->wind_dir, obs->wind_spd, obs->wind_gust);
  } else {
    snprintf(out, len, "%03d/%d", obs->wind_dir, obs->wind_spd);
  }
}

/*
 * Pebble lays text out with leading above the cap height, so a box of exactly
 * the font size clips.  Measure, then centre what was measured.
 */
int16_t draw_centred_text(GContext *ctx, const char *text, GFont font, GRect box,
                          GTextAlignment align, GColor color) {
  if (!text || !text[0]) return 0;
  GSize size = graphics_text_layout_get_content_size(
      text, font, GRect(0, 0, box.size.w, 200), GTextOverflowModeTrailingEllipsis, align);
  int16_t dy = (int16_t)((box.size.h - size.h) / 2);
  if (dy < 0) dy = 0;
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, text, font,
                     GRect(box.origin.x, box.origin.y + dy, box.size.w, size.h + 4),
                     GTextOverflowModeTrailingEllipsis, align, NULL);
  return size.w;
}

void draw_value(GContext *ctx, const char *text, GFont font, GRect box,
                GTextAlignment align, uint8_t cat, bool amber) {
  if (!text || !text[0]) return;

  bool block = (cat != CAT_VFR && cat != CAT_UNKNOWN);
  GColor fg = GColorWhite;

  if (block) {
    GSize size = graphics_text_layout_get_content_size(
        text, font, GRect(0, 0, box.size.w, 200), GTextOverflowModeTrailingEllipsis, align);
    int16_t dy = (int16_t)((box.size.h - size.h) / 2);
    if (dy < 0) dy = 0;

    int16_t x = box.origin.x;
    if (align == GTextAlignmentRight) x = box.origin.x + box.size.w - size.w;
    else if (align == GTextAlignmentCenter) x = box.origin.x + (box.size.w - size.w) / 2;

    graphics_context_set_fill_color(ctx, cat_color(cat));
    graphics_fill_rect(ctx,
                       GRect(x - 7, box.origin.y + dy - 1, size.w + 14, size.h + 2),
                       0, GCornerNone);
    fg = cat_text_color(cat);
  } else if (amber) {
    /* Personal minima only colour a value the regulations have not already
     * flagged: the block is the stronger signal and owns the value it is on. */
    fg = GColorChromeYellow;
  }

  draw_centred_text(ctx, text, font, box, align, fg);
}

/*
 * The loading indicator.  A dim ring with a bright arc going round it, the
 * shape people already read as "working".  It never replaces a value: the
 * reading underneath stays on screen, with its age, while a newer one is
 * fetched.
 */
void draw_busy(GContext *ctx, GRect bounds, int16_t right, int16_t cy) {
  if (!state()->busy) return;
  const int16_t r = SX(bounds, 7);
  GRect box = GRect(right - 2 * r, cy - r, 2 * r, 2 * r);

  graphics_context_set_antialiased(ctx, true);
  graphics_context_set_stroke_width(ctx, 2);
  graphics_context_set_stroke_color(ctx, GColorDarkGray);
  graphics_draw_arc(ctx, box, GOvalScaleModeFitCircle, 0, TRIG_MAX_ANGLE);

  int32_t start = (int32_t)busy_frame() * (TRIG_MAX_ANGLE / 12);
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_arc(ctx, box, GOvalScaleModeFitCircle, start, start + TRIG_MAX_ANGLE / 3);
}

void draw_rule(GContext *ctx, GRect bounds, int16_t y, GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_line(ctx, GPoint(0, y), GPoint(bounds.size.w, y));
}
