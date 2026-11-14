#include "avwx.h"

/*
 * Page 2 -- Wind.
 *
 * The rose is drawn in degrees TRUE, matching the METAR wind, and the runway
 * bar uses the runway's true heading, so the picture and the arithmetic are in
 * the same reference frame.  The runway *label* is the magnetic identifier,
 * because that is the number painted on the pavement.
 *
 * The bar is labelled "RWY 23R" and never "active" or "in use".  The app has
 * not heard the ATIS; the runway shown is the longest one with the wind on the
 * nose, which is usually but not always what is in use.
 */

#define PAD 10

static GPoint polar(GPoint centre, int16_t r, int32_t deg) {
  int32_t a = DEG_TO_TRIGANGLE(deg);
  return GPoint(centre.x + (int16_t)((sin_lookup(a) * r) / TRIG_MAX_RATIO),
                centre.y - (int16_t)((cos_lookup(a) * r) / TRIG_MAX_RATIO));
}

/* The arrow lives outside the ring and points inward, so it never overlaps the
 * speed in the middle.  Kept as a static path because gpath_create copies the
 * pointer, not the points. */
static GPoint s_arrow_points[3];
static GPathInfo s_arrow_info = { 3, s_arrow_points };
static GPath *s_arrow = NULL;
static int16_t s_arrow_radius = 0;

static GPath *arrow_path(int16_t ring_r) {
  if (s_arrow && s_arrow_radius == ring_r) return s_arrow;
  if (s_arrow) {
    gpath_destroy(s_arrow);
    s_arrow = NULL;
  }
  int16_t tip = (int16_t)(ring_r - 6);
  int16_t base = (int16_t)(ring_r + 12);
  s_arrow_points[0] = GPoint(0, -tip);
  s_arrow_points[1] = GPoint(-9, -base);
  s_arrow_points[2] = GPoint(9, -base);
  s_arrow = gpath_create(&s_arrow_info);
  s_arrow_radius = ring_r;
  return s_arrow;
}

static void draw_rose(GContext *ctx, GRect bounds) {
  const AppState *s = state();
  const GPoint centre = GPoint(bounds.size.w / 2, SY(bounds, 114));
  const int16_t ring_r = SY(bounds, 64);
  const int16_t hub_r = SY(bounds, 32);

  graphics_context_set_antialiased(ctx, true);

  /* 1. Runway bar, drawn first so nothing it crosses is struck through. */
  if (s->obs.rwy_ident[0]) {
    int32_t hdg = s->obs.rwy_hdg_true;
    GPoint a = polar(centre, (int16_t)(ring_r - 8), hdg);
    GPoint b = polar(centre, (int16_t)(ring_r - 8), (hdg + 180) % 360);
    graphics_context_set_stroke_color(ctx, GColorDarkGray);
    graphics_context_set_stroke_width(ctx, 9);
    graphics_draw_line(ctx, a, b);
  }

  /* 2. Hub, masking the bar behind the centre text. */
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_circle(ctx, centre, hub_r);

  /* 3. Rose ring. */
  graphics_context_set_stroke_color(ctx, GColorLightGray);
  graphics_context_set_stroke_width(ctx, 2);
  graphics_draw_circle(ctx, centre, ring_r);

  /* 4. Cardinal ticks: north longer and white, the rest shorter and grey. */
  graphics_context_set_stroke_width(ctx, 3);
  graphics_context_set_stroke_color(ctx, GColorWhite);
  graphics_draw_line(ctx, polar(centre, ring_r, 0), polar(centre, (int16_t)(ring_r - 11), 0));
  graphics_context_set_stroke_width(ctx, 2);
  graphics_context_set_stroke_color(ctx, GColorLightGray);
  for (int32_t deg = 90; deg < 360; deg += 90) {
    graphics_draw_line(ctx, polar(centre, ring_r, deg), polar(centre, (int16_t)(ring_r - 8), deg));
  }

  /* 5. North label. */
  draw_centred_text(ctx, "N", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                    GRect(centre.x - 10, centre.y - ring_r - SY(bounds, 26), 20, SY(bounds, 18)),
                    GTextAlignmentCenter, GColorWhite);

  /* 6. Wind arrow, only where there is a direction to point. */
  if (s->obs.wind_dir >= 0) {
    bool warn = s->obs.wind_gust > 0 ||
                (s->obs.flags & (FLAG_WIND | FLAG_GUST | FLAG_XW | FLAG_XW_GUST)) != 0;
    GPath *arrow = arrow_path(ring_r);
    gpath_move_to(arrow, centre);
    gpath_rotate_to(arrow, DEG_TO_TRIGANGLE(s->obs.wind_dir));
    graphics_context_set_fill_color(ctx, warn ? GColorChromeYellow : GColorWhite);
    gpath_draw_filled(ctx, arrow);
  }

  /* 7. Centre text.  LECO is a digits-only face, so only the bare speed goes
   * in it; anything with a letter or a slash uses a Gothic face.  A missing
   * wind is "--", not "0": zero knots is a reading, and this is not one. */
  GRect speed_box = GRect(centre.x - SX(bounds, 40), centre.y - SY(bounds, 32),
                          SX(bounds, 80), SY(bounds, 46));
  if (s->obs.wind_dir == WIND_DIR_MISSING) {
    draw_centred_text(ctx, "--", fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD),
                      speed_box, GTextAlignmentCenter, GColorLightGray);
  } else {
    char speed[6];
    snprintf(speed, sizeof(speed), "%d", s->obs.wind_spd);
    draw_centred_text(ctx, speed, fonts_get_system_font(FONT_KEY_LECO_42_NUMBERS),
                      speed_box, GTextAlignmentCenter, GColorWhite);
  }

  if (s->obs.wind_gust) {
    char gust[8];
    snprintf(gust, sizeof(gust), "G%d", s->obs.wind_gust);
    draw_centred_text(ctx, gust, fonts_get_system_font(FONT_KEY_GOTHIC_18),
                      GRect(centre.x - SX(bounds, 40), centre.y + SY(bounds, 14),
                            SX(bounds, 80), SY(bounds, 20)),
                      GTextAlignmentCenter, GColorChromeYellow);
  }

  /* A trailing T rather than a degree sign: the Gothic glyph set may not have
   * one, and "265T" also says which reference frame this is. */
  char bearing[8];
  if (s->obs.wind_dir >= 0) snprintf(bearing, sizeof(bearing), "%03dT", s->obs.wind_dir);
  else if (s->obs.wind_dir == WIND_DIR_VRB) snprintf(bearing, sizeof(bearing), "VRB");
  else if (s->obs.wind_dir == WIND_DIR_CALM) snprintf(bearing, sizeof(bearing), "CALM");
  else snprintf(bearing, sizeof(bearing), "--");
  draw_centred_text(ctx, bearing, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                    GRect(centre.x - SX(bounds, 40), centre.y + SY(bounds, 32),
                          SX(bounds, 80), SY(bounds, 18)),
                    GTextAlignmentCenter, GColorLightGray);
}

static void draw_components(GContext *ctx, GRect bounds) {
  const AppState *s = state();
  const int16_t pad = SX(bounds, PAD);
  GFont bold = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  GRect row = GRect(pad, SY(bounds, 189), bounds.size.w - 2 * pad, SY(bounds, 22));

  if (s->obs.xw_side == XW_SIDE_NONE) {
    /* No runway heading, or no wind direction.  A component figure computed
     * from an assumed heading would be worse than none, so there is none. */
    draw_centred_text(ctx, s->obs.rwy_ident[0] ? "NO WIND DIRECTION" : "NO RUNWAY DATA",
                      small, row, GTextAlignmentCenter, GColorLightGray);
  } else {
    char hw[10], xw[10];
    /* A negative headwind is a tailwind, and pilots read it as one. */
    if (s->obs.hw < 0) snprintf(hw, sizeof(hw), "TW %d", -s->obs.hw);
    else snprintf(hw, sizeof(hw), "HW %d", s->obs.hw);
    /* Zero crosswind has no side to crab towards. */
    snprintf(xw, sizeof(xw), "XW %d%s", s->obs.xw,
             s->obs.xw == 0 ? "" : (s->obs.xw_side == XW_SIDE_RIGHT ? "R" : "L"));
    bool xw_amber = (s->obs.flags & (FLAG_XW | FLAG_XW_GUST)) != 0;
    draw_centred_text(ctx, hw, bold, row, GTextAlignmentLeft, GColorWhite);
    draw_centred_text(ctx, xw, bold, row, GTextAlignmentRight,
                      xw_amber ? GColorChromeYellow : GColorWhite);
  }

  if (s->obs.rwy_ident[0]) {
    char label[32];
    if (s->obs.rwy_len_ft) {
      char length[10];
      format_length_ft(length, sizeof(length), s->obs.rwy_len_ft);
      snprintf(label, sizeof(label), "RWY %s · %s FT", s->obs.rwy_ident, length);
    } else {
      snprintf(label, sizeof(label), "RWY %s", s->obs.rwy_ident);
    }
    draw_centred_text(ctx, label, small,
                      GRect(pad, SY(bounds, 209), bounds.size.w - 2 * pad, SY(bounds, 18)),
                      GTextAlignmentCenter, GColorLightGray);
  }
}

void page_wind_draw(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  const AppState *s = state();
  const int16_t pad = SX(bounds, PAD);

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  GRect header = GRect(pad, 0, bounds.size.w - 2 * pad, SY(bounds, 30));
  draw_centred_text(ctx, s->obs.station[0] ? s->obs.station : "----",
                    fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                    header, GTextAlignmentLeft, GColorWhite);

  int32_t age = obs_age_minutes();
  char age_str[10];
  format_age(age_str, sizeof(age_str), age);
  int16_t age_w = draw_centred_text(ctx, age_str, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                                    header, GTextAlignmentRight, age_color(age));
  draw_busy(ctx, bounds, (int16_t)(bounds.size.w - pad - age_w - SX(bounds, 6)),
            (int16_t)(header.size.h / 2));

  if (s->obs.is_nearest) {
    draw_centred_text(ctx, "NRST", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                      header, GTextAlignmentCenter, GColorLightGray);
  }

  draw_rose(ctx, bounds);
  draw_rule(ctx, bounds, SY(bounds, 188), GColorDarkGray);
  draw_components(ctx, bounds);
}
