#include "avwx.h"

/*
 * Page 1 -- Home.
 *
 * Wind, visibility and ceiling are the three primary values, each on its own
 * row at 28pt.  The regulatory flight category is spelled out in the footer
 * and shown as a block on whichever value earned it: the premise of the whole
 * design is that the number which limits you matters more than the label
 * derived from it.
 */

#define PAD 10

typedef struct {
  const char *label;
  const char *value;
  uint8_t cat;
  bool amber;
  bool big;
} Row;

static void draw_header(GContext *ctx, GRect bounds) {
  const AppState *s = state();
  const int16_t h = SY(bounds, 36);
  const int16_t pad = SX(bounds, PAD);

  draw_centred_text(ctx, s->obs.station[0] ? s->obs.station : "----",
                    fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD),
                    GRect(pad, 0, bounds.size.w / 2, h), GTextAlignmentLeft, GColorWhite);

  int32_t age = obs_age_minutes();
  char age_str[10];
  format_age(age_str, sizeof(age_str), age);
  int16_t age_w = draw_centred_text(ctx, age_str, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                                    GRect(bounds.size.w / 2, 0, bounds.size.w / 2 - pad, h),
                                    GTextAlignmentRight, age_color(age));
  /* The slot just left of the age holds the loading indicator, or the
   * disconnected mark -- never both, since a phone that is gone is not
   * fetching anything. */
  const int16_t slot_right = (int16_t)(bounds.size.w - pad - age_w - SX(bounds, 6));

  /* The user must never be uncertain about which airport they are looking at. */
  if (s->obs.is_nearest) {
    const int16_t tw = 34, th = 16;
    GRect tag = GRect((bounds.size.w - tw) / 2, (h - th) / 2, tw, th);
    graphics_context_set_fill_color(ctx, GColorDarkGray);
    graphics_fill_rect(ctx, tag, 0, GCornerNone);
    draw_centred_text(ctx, "NRST", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                      tag, GTextAlignmentCenter, GColorWhite);
  }

  /* A disconnected phone does not blank the page -- the cached reading, with
   * its age counting up, is more use than a spinner -- but it is never left
   * unsaid either. */
  if (!connection_service_peek_pebble_app_connection()) {
    graphics_context_set_stroke_color(ctx, GColorChromeYellow);
    graphics_context_set_stroke_width(ctx, 2);
    int16_t cx = slot_right - 5, cy = h / 2;
    graphics_draw_line(ctx, GPoint(cx - 5, cy - 5), GPoint(cx + 5, cy + 5));
    graphics_draw_line(ctx, GPoint(cx + 5, cy - 5), GPoint(cx - 5, cy + 5));
  } else {
    draw_busy(ctx, bounds, slot_right, h / 2);
  }
}

static void draw_row(GContext *ctx, GRect bounds, GRect box, const Row *row) {
  const int16_t pad = SX(bounds, PAD);

  draw_centred_text(ctx, row->label, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                    GRect(box.origin.x + pad, box.origin.y, SX(bounds, 44), box.size.h),
                    GTextAlignmentLeft, GColorLightGray);

  GFont font = fonts_get_system_font(row->big ? FONT_KEY_GOTHIC_28_BOLD
                                              : FONT_KEY_GOTHIC_24_BOLD);
  GRect value_box = GRect(box.origin.x + SX(bounds, 54), box.origin.y,
                          box.size.w - SX(bounds, 54) - pad, box.size.h);
  draw_value(ctx, row->value, font, value_box, GTextAlignmentRight, row->cat, row->amber);
}

/* First launch, an unreporting station, an API failure: each says what is
 * happening rather than showing an empty screen. */
static const char *state_message(void) {
  const AppState *s = state();
  if (s->busy & BUSY_NEAREST) return "LOCATING…";
  switch (s->obs.error) {
    case ERR_NOT_CONFIGURED: return "NO AIRPORT SET";
    case ERR_NO_REPORT:  return "NO REPORT";
    case ERR_API:        return "DATA UNAVAILABLE";
    case ERR_NO_STATION: return "NO STATION NEAR";
    case ERR_NO_GPS:     return "NO LOCATION";
    case ERR_FETCHING:
      if (s->obs.have_data) return NULL;
      /* Only say FETCHING while something is.  A launch the phone never
       * answered used to sit on FETCHING for as long as the app stayed open. */
      if (s->busy) return "FETCHING…";
      return connection_service_peek_pebble_app_connection() ? "NO RESPONSE" : "NO PHONE";
    default:             return NULL;
  }
}

void page_home_draw(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  const AppState *s = state();
  const int16_t pad = SX(bounds, PAD);

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  draw_header(ctx, bounds);
  draw_rule(ctx, bounds, SY(bounds, 36), GColorWhite);

  const char *message = state_message();
  if ((!s->obs.have_data || s->obs.error == ERR_NOT_CONFIGURED) && message) {
    draw_centred_text(ctx, message, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                      GRect(pad, SY(bounds, 84), bounds.size.w - 2 * pad, SY(bounds, 30)),
                      GTextAlignmentCenter, GColorLightGray);
    /* A first-run user needs to know where to go, not just that something is
     * missing.  Anything else that lands here is self-explanatory. */
    /* With no airport set, the page depends on the nearest station.  When
     * that cannot be found, say where to go instead. */
    bool needs_airport = s->obs.error == ERR_NOT_CONFIGURED ||
        (s->settings.station_count == 0 &&
         (s->obs.error == ERR_NO_GPS || s->obs.error == ERR_NO_STATION));
    if (needs_airport) {
      /* Each failure has its own way out. */
      const char *line1 = "Set one in the";
      const char *line2 = "Pebble app settings";
      if (s->obs.error == ERR_NO_GPS) {
        line1 = "Allow location, or set an";
        line2 = "airport in the app settings";
      } else if (s->obs.error == ERR_NO_STATION) {
        line1 = "Widen the search radius, or";
        line2 = "set an airport in settings";
      }
      draw_centred_text(ctx, line1, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                        GRect(pad, SY(bounds, 116), bounds.size.w - 2 * pad, SY(bounds, 18)),
                        GTextAlignmentCenter, GColorLightGray);
      draw_centred_text(ctx, line2,
                        fonts_get_system_font(FONT_KEY_GOTHIC_14),
                        GRect(pad, SY(bounds, 134), bounds.size.w - 2 * pad, SY(bounds, 18)),
                        GTextAlignmentCenter, GColorLightGray);
    }
#if defined(PBL_TOUCH)
    else if (!s->busy && connection_service_peek_pebble_app_connection()) {
      draw_centred_text(ctx, "Tap to try again", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                        GRect(pad, SY(bounds, 116), bounds.size.w - 2 * pad, SY(bounds, 18)),
                        GTextAlignmentCenter, GColorLightGray);
    }
#endif
    return;
  }

  char wind[16];
  format_wind(wind, sizeof(wind), &s->obs);
  bool wind_amber = (s->obs.flags & (FLAG_WIND | FLAG_GUST)) != 0;

  const Row rows[3] = {
    /* Wind never carries a category block: it does not determine the category. */
    { "WIND", wind, CAT_UNKNOWN, wind_amber, s->obs.wind_gust == 0 },
    { "VIS", s->obs.vis, s->obs.cat_vis, (s->obs.flags & FLAG_VIS) != 0, true },
    { "CIG", s->obs.cig, s->obs.cat_cig, (s->obs.flags & FLAG_CIG) != 0, true }
  };
  for (int i = 0; i < 3; i++) {
    draw_row(ctx, bounds,
             GRect(0, SY(bounds, 37 + 46 * i), bounds.size.w, SY(bounds, 46)),
             &rows[i]);
  }

  GRect secondary = GRect(pad, SY(bounds, 175), bounds.size.w - 2 * pad, SY(bounds, 24));
  GFont small = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  draw_centred_text(ctx, s->obs.altim, small, secondary, GTextAlignmentLeft, GColorLightGray);
  draw_centred_text(ctx, s->obs.temp, small, secondary, GTextAlignmentRight, GColorLightGray);

  draw_rule(ctx, bounds, SY(bounds, 199), GColorDarkGray);

  GRect footer = GRect(pad, SY(bounds, 200), bounds.size.w - 2 * pad, SY(bounds, 28));
  /* The category is always spelled out, so the colour is never the only thing
   * carrying it. */
  draw_centred_text(ctx, cat_name(s->obs.cat_overall),
                    fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                    footer, GTextAlignmentLeft, cat_color(s->obs.cat_overall));

  if (message) {
    draw_centred_text(ctx, message, small, footer, GTextAlignmentRight, GColorChromeYellow);
  } else if (s->obs.obs_epoch > 0) {
    time_t t = (time_t)s->obs.obs_epoch;
    struct tm *utc = gmtime(&t);
    char obs_time[8];
    strftime(obs_time, sizeof(obs_time), "%H%MZ", utc);
    draw_centred_text(ctx, obs_time, small, footer, GTextAlignmentRight, GColorLightGray);
  }
}
