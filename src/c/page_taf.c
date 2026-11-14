#include "avwx.h"

/*
 * Page 3 -- TAF.
 *
 * One row per forecast period, with an 8px colour bar down the left.  The
 * first row is NOW and shows the observed category, so the colour column
 * starts from what is actually happening rather than from what was forecast.
 *
 * A TEMPO or PROB group is not a period.  It is drawn as a narrow inset bar
 * inside its parent row's colour bar, and the row label carries an asterisk --
 * the asterisk is what makes the information survive on a dim display or for a
 * reader who cannot separate the two colours.
 */

#define PAD 10

static void draw_period(GContext *ctx, GRect bounds, GRect row, uint8_t index) {
  const Forecast *f = &state()->taf;
  const int16_t bar_w = SX(bounds, 8);

  /* Row 0 is NOW, and NOW is the observation by definition.  Taking its colour
   * from the live observation rather than from whatever was current when the
   * forecast was fetched keeps the column honest if the two arrive out of
   * order -- which they do whenever the TAF page is opened first. */
  uint8_t row_cat = (index == 0 && state()->obs.have_data)
                        ? state()->obs.cat_overall : f->cat[index];

  graphics_context_set_fill_color(ctx, cat_color(row_cat));
  graphics_fill_rect(ctx, GRect(0, row.origin.y, bar_w, row.size.h), 0, GCornerNone);

  if (f->tempo_cat[index] != CAT_UNKNOWN) {
    graphics_context_set_fill_color(ctx, cat_color(f->tempo_cat[index]));
    graphics_fill_rect(ctx, GRect(bar_w - SX(bounds, 3), row.origin.y + 3,
                                  SX(bounds, 3), row.size.h - 6),
                       0, GCornerNone);
  }

  draw_centred_text(ctx, f->label[index], fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                    GRect(SX(bounds, 17), row.origin.y, SX(bounds, 60), row.size.h),
                    GTextAlignmentLeft, GColorWhite);

  draw_centred_text(ctx, f->text[index], fonts_get_system_font(FONT_KEY_GOTHIC_18),
                    GRect(SX(bounds, 77), row.origin.y,
                          bounds.size.w - SX(bounds, 77) - SX(bounds, PAD), row.size.h),
                    GTextAlignmentRight, GColorWhite);
}

void page_taf_draw(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  const AppState *s = state();
  const int16_t pad = SX(bounds, PAD);

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  char title[16];
  snprintf(title, sizeof(title), "TAF %s", s->obs.station[0] ? s->obs.station : "----");
  GRect header = GRect(pad, 0, bounds.size.w - 2 * pad, SY(bounds, 34));
  draw_centred_text(ctx, title, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                    header, GTextAlignmentLeft, GColorWhite);
  int16_t issue_w = draw_centred_text(ctx, s->taf.issue, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                                      header, GTextAlignmentRight, GColorLightGray);
  draw_busy(ctx, bounds,
            (int16_t)(bounds.size.w - pad - issue_w - (issue_w ? SX(bounds, 6) : 0)),
            (int16_t)(header.size.h / 2));
  draw_rule(ctx, bounds, SY(bounds, 34), GColorDarkGray);

  if (!s->taf.have_data || s->taf.count == 0) {
    /* FETCHING only while something is; otherwise the request never got an
     * answer, and saying FETCHING would be waiting for nothing. */
    bool fetching = (s->busy & BUSY_TAF) != 0;
    draw_centred_text(ctx, fetching ? "FETCHING…" : "NOT LOADED",
                      fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                      GRect(pad, SY(bounds, 90), bounds.size.w - 2 * pad, SY(bounds, 40)),
                      GTextAlignmentCenter, GColorLightGray);
#if defined(PBL_TOUCH)
    if (!fetching) {
      draw_centred_text(ctx, "Tap to try again", fonts_get_system_font(FONT_KEY_GOTHIC_14),
                        GRect(pad, SY(bounds, 128), bounds.size.w - 2 * pad, SY(bounds, 18)),
                        GTextAlignmentCenter, GColorLightGray);
    }
#endif
    return;
  }

  const int16_t top = SY(bounds, 35);
  const int16_t bottom = SY(bounds, 203);

  /* Row height comes from the *configured* number of periods, not from how
   * many arrived, so rows stay the same size whatever the forecast holds --
   * and a station with no TAF at all gets a normal-sized NOW row rather than
   * one stretched down the whole page. */
  uint8_t slots = s->settings.taf_periods;
  if (slots < 2) slots = 2;
  if (slots > MAX_TAF_PERIODS) slots = MAX_TAF_PERIODS;
  const int16_t row_h = (int16_t)((bottom - top) / slots);

  for (uint8_t i = 0; i < s->taf.count && i < MAX_TAF_PERIODS; i++) {
    draw_period(ctx, bounds, GRect(0, top + row_h * i, bounds.size.w, row_h), i);
  }

  /* Only the NOW row means the station publishes no forecast.  Say so: an
   * unexplained near-empty page reads as a bug, or worse as good news. */
  if (s->taf.count <= 1) {
    /* Two different situations: the station publishes no forecast, or the
     * fetch failed.  Saying "no TAF" for a network error would tell the pilot
     * there is no forecast when there may well be one. */
    draw_centred_text(ctx, s->taf.error == ERR_NONE ? "NO TAF FOR THIS STATION"
                                                    : "TAF UNAVAILABLE",
                      fonts_get_system_font(FONT_KEY_GOTHIC_14),
                      GRect(pad, top + row_h + SY(bounds, 20),
                            bounds.size.w - 2 * pad, SY(bounds, 20)),
                      GTextAlignmentCenter, GColorLightGray);
  }

  draw_centred_text(ctx, s->taf.valid, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                    GRect(pad, bottom, bounds.size.w - 2 * pad, SY(bounds, 25)),
                    GTextAlignmentRight, GColorLightGray);
}
