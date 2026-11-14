#include "gesture.h"

static int16_t abs16(int16_t v) {
  return v < 0 ? (int16_t)-v : v;
}

Gesture gesture_classify(int16_t dx, int16_t dy, uint32_t duration_ms) {
  const int16_t ax = abs16(dx), ay = abs16(dy);

  if (ax < GESTURE_TAP_SLOP && ay < GESTURE_TAP_SLOP) {
    return duration_ms <= GESTURE_TAP_MAX_MS ? GESTURE_TAP : GESTURE_NONE;
  }
  if (ax >= GESTURE_SWIPE_MIN && ax >= 2 * ay) {
    return dx < 0 ? GESTURE_SWIPE_LEFT : GESTURE_SWIPE_RIGHT;
  }
  if (ay >= GESTURE_DRAG_MIN && ay >= 2 * ax) {
    return dy < 0 ? GESTURE_DRAG_UP : GESTURE_DRAG_DOWN;
  }
  return GESTURE_NONE;
}

bool gesture_is_vertical_drag(int16_t dx, int16_t dy) {
  const int16_t ax = abs16(dx), ay = abs16(dy);
  return ay >= GESTURE_TAP_SLOP && ay >= 2 * ax;
}
