#include "avwx.h"

/*
 * Page 4 -- the raw METAR.
 *
 * Everything else on the watch is a derived, formatted view.  This page is the
 * source text, so a pilot who wants to check a remark, a runway visual range
 * or anything else the display leaves out can see exactly what was reported.
 */

#define PAD 8

/* The report is read group by group, often to check one remark, so it gets the
 * large face.  A long report runs past the footer and scrolls (Up/Down, or drag
 * on touch); a typical one fits.  Drawing and the scroll limit below must
 * measure with the same font, hence one definition. */
#define RAW_FONT FONT_KEY_GOTHIC_24_BOLD

/* Width of the column the report is drawn in. */
static int16_t column_width(GRect bounds) {
  return (int16_t)(bounds.size.w - SX(bounds, 5) - 2 * SX(bounds, PAD));
}

static int16_t natural_width(const char *text) {
  return graphics_text_layout_get_content_size(text, fonts_get_system_font(RAW_FONT),
                                               GRect(0, 0, 2000, 200),
                                               GTextOverflowModeWordWrap,
                                               GTextAlignmentLeft).w;
}

/*
 * The report as drawn: the raw text, with a line break placed inside any group
 * too wide for a line.  Left to itself the text layout breaks such a group and
 * adds a hyphen -- "UPE2055B12E27RAB5-" / "1SNB11E12B16E20" -- and a hyphen
 * means something in a METAR: it is how light intensity is written.  A plain
 * line break adds nothing that could be read as part of the report.
 *
 * At this size a line holds about 17 characters, and remark groups such as
 * precipitation begin/end times run past that.  The result is cached and only
 * rebuilt when the report or the column width changes, because the page is
 * redrawn on every frame of the loading indicator.
 */
#define DISPLAY_MAX 240

static char s_display[DISPLAY_MAX];
static char s_display_src[sizeof(((Observation *)0)->raw)];
static int16_t s_display_width = -1;

static const char *display_text(const char *raw, int16_t width) {
  if (width == s_display_width && strcmp(raw, s_display_src) == 0) return s_display;
  strncpy(s_display_src, raw, sizeof(s_display_src) - 1);
  s_display_src[sizeof(s_display_src) - 1] = '\0';
  s_display_width = width;

  /* A couple of pixels in hand, so a piece measured as fitting is never the
   * one the layout decides is a hair too wide. */
  const int16_t fit = (int16_t)(width - 2);
  char piece[sizeof(s_display_src)];
  size_t out = 0;
  const char *p = s_display_src;

  while (*p && out < DISPLAY_MAX - 1) {
    if (*p == ' ') {
      s_display[out++] = *p++;
      continue;
    }
    size_t n = strcspn(p, " ");
    size_t start = 0;
    while (start < n && out < DISPLAY_MAX - 1) {
      /* The longest run of this group, from `start`, that fits on a line. */
      size_t len = n - start;
      for (;;) {
        memcpy(piece, p + start, len);
        piece[len] = '\0';
        if (len == 1 || natural_width(piece) <= fit) break;
        len--;
      }
      if (start > 0) s_display[out++] = '\n';
      for (size_t i = 0; i < len && out < DISPLAY_MAX - 1; i++) s_display[out++] = piece[i];
      start += len;
    }
    p += n;
  }
  s_display[out] = '\0';
  return s_display;
}

static const char *report_for(GRect bounds) {
  const Observation *o = &state()->obs;
  return display_text(o->raw[0] ? o->raw : "NO RAW REPORT", column_width(bounds));
}

void page_raw_draw(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  const AppState *s = state();

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  graphics_context_set_fill_color(ctx, cat_color(s->obs.cat_overall));
  graphics_fill_rect(ctx, GRect(0, 0, SX(bounds, 5), bounds.size.h), 0, GCornerNone);

  const int16_t pad = SX(bounds, PAD);
  const int16_t footer_h = SY(bounds, 22);
  GRect text_box = GRect(SX(bounds, 5) + pad, SY(bounds, 4), column_width(bounds),
                         bounds.size.h - footer_h - SY(bounds, 8));

  const char *raw = report_for(bounds);
  text_box.origin.y -= s->raw_scroll;
  text_box.size.h += s->raw_scroll;
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, raw, fonts_get_system_font(RAW_FONT), text_box,
                     GTextOverflowModeWordWrap, GTextAlignmentLeft, NULL);

  /* The category bar and the footer sit over the text, so a long report
   * scrolling past them stays readable. */
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, GRect(SX(bounds, 5), bounds.size.h - footer_h,
                                bounds.size.w - SX(bounds, 5), footer_h),
                     0, GCornerNone);
  graphics_context_set_fill_color(ctx, cat_color(s->obs.cat_overall));
  graphics_fill_rect(ctx, GRect(0, 0, SX(bounds, 5), bounds.size.h), 0, GCornerNone);

  GRect footer = GRect(SX(bounds, 5) + pad, bounds.size.h - footer_h,
                       bounds.size.w - SX(bounds, 5) - 2 * pad, footer_h);
  draw_centred_text(ctx, cat_name(s->obs.cat_overall),
                    fonts_get_system_font(FONT_KEY_GOTHIC_14), footer,
                    GTextAlignmentLeft, cat_color(s->obs.cat_overall));

  int32_t age = obs_age_minutes();
  char age_str[10];
  format_age(age_str, sizeof(age_str), age);
  int16_t age_w = draw_centred_text(ctx, age_str, fonts_get_system_font(FONT_KEY_GOTHIC_14),
                                    footer, GTextAlignmentRight, age_color(age));
  draw_busy(ctx, bounds,
            (int16_t)(footer.origin.x + footer.size.w - age_w - SX(bounds, 6)),
            (int16_t)(footer.origin.y + footer.size.h / 2));
}

/*
 * How far past the bottom of the screen the report runs, which is how far
 * Up/Down are allowed to scroll it.  Measured rather than assumed: a long
 * remarks section is several lines more than a bare report.
 */
int16_t page_raw_overflow(GRect bounds) {
  GSize size = graphics_text_layout_get_content_size(
      report_for(bounds), fonts_get_system_font(RAW_FONT),
      GRect(0, 0, column_width(bounds), 1000),
      GTextOverflowModeWordWrap, GTextAlignmentLeft);
  int16_t visible = (int16_t)(bounds.size.h - SY(bounds, 22) - SY(bounds, 12));
  int16_t overflow = (int16_t)(size.h - visible);
  return overflow > 0 ? overflow : 0;
}
