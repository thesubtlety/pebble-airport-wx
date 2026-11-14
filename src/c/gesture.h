#pragma once
#include <stdbool.h>
#include <stdint.h>

/*
 * Touch gesture classification, kept free of SDK calls so it can be compiled
 * and tested on the host (test/gesture_test.c, run by tools/check-c.sh).
 *
 * The app reads the raw touch stream and decides what a finished touch was
 * from where it started, where it ended and how long it took.  The SDK also
 * has gesture recognizers, but in the 4.44 emulator they never reported a
 * gesture while the raw stream did, and Core's own touch example uses the raw
 * stream -- so this is the path that could be tested.
 */

typedef enum {
  GESTURE_NONE = 0,
  GESTURE_TAP,
  GESTURE_SWIPE_LEFT,
  GESTURE_SWIPE_RIGHT,
  GESTURE_DRAG_UP,
  GESTURE_DRAG_DOWN
} Gesture;

/* Movement under this many pixels each way is a finger that stayed put. */
#define GESTURE_TAP_SLOP 10
/* A tap is a touch, not a press-and-hold. */
#define GESTURE_TAP_MAX_MS 500
/* A horizontal swipe must cross a fifth of the screen. */
#define GESTURE_SWIPE_MIN 40
/* A vertical drag must go far enough that a wobble does not change airport. */
#define GESTURE_DRAG_MIN 30

/* dx, dy: liftoff minus touchdown, in pixels.  duration_ms: touchdown to
 * liftoff.  A movement has to be clearly along one axis -- twice as far as
 * along the other -- or it is ignored rather than guessed at. */
Gesture gesture_classify(int16_t dx, int16_t dy, uint32_t duration_ms);

/* Whether a finger still down has moved far enough to be a vertical drag,
 * so the raw page can start scrolling under it. */
bool gesture_is_vertical_drag(int16_t dx, int16_t dy);
