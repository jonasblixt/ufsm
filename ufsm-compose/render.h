#ifndef CANVAS_VIEW_H_
#define CANVAS_VIEW_H_

#include <stdint.h>
#include <ufsm/model.h>
#include <cairo/cairo.h>
#include "controller.h"

enum ufsmm_color {
    UFSMM_COLOR_BG,
    UFSMM_COLOR_RED1,
    UFSMM_COLOR_GREEN1,
    UFSMM_COLOR_YELLOW1,
    UFSMM_COLOR_BLUE1,
    UFSMM_COLOR_PURPLE1,
    UFSMM_COLOR_AQUA1,
    UFSMM_COLOR_GRAY1,
    UFSMM_COLOR_GRAY2,
    UFSMM_COLOR_RED2,
    UFSMM_COLOR_GREEN2,
    UFSMM_COLOR_YELLOW2,
    UFSMM_COLOR_BLUE2,
    UFSMM_COLOR_PURPLE2,
    UFSMM_COLOR_AQUA2,
    UFSMM_COLOR_FG,
    UFSMM_COLOR_BG0_H,
    UFSMM_COLOR_BG0,
    UFSMM_COLOR_BG1,
    UFSMM_COLOR_BG2,
    UFSMM_COLOR_BG3,
    UFSMM_COLOR_BG4,
    UFSMM_COLOR_GRAY3,
    UFSMM_COLOR_ORANGE1,
    UFSMM_COLOR_BG0_S,
    UFSMM_COLOR_FG4,
    UFSMM_COLOR_FG3,
    UFSMM_COLOR_FG2,
    UFSMM_COLOR_FG1,
    UFSMM_COLOR_FG0,
    UFSMM_COLOR_ORANGE2,
};


enum ufsmm_paper_size {
    UFSMM_PAPER_SIZE_INVALID,
    UFSMM_PAPER_SIZE_A4,
    UFSMM_PAPER_SIZE_A3,
    UFSMM_PAPER_SIZE_A2,
    UFSMM_PAPER_SIZE_A1,
};

enum ufsmm_transition_vertice_selector {
    UFSMM_TRANS_NO_SELECTION,
    UFSMM_TRANS_BEGIN,
    UFSMM_TRANS_VERT,
    UFSMM_TRANS_END,
};

int ufsmm_color_set(cairo_t *cr, enum ufsmm_color_theme theme,
                                 enum ufsmm_color color);
int ufsmm_canvas_render(struct ufsmm_canvas *canvas, int width, int height);
int ufsmm_canvas_render_grid(struct ufsmm_canvas *canvas, int width, int height);
int ufsmm_canvas_render_state(struct ufsmm_canvas *canvas,
                              struct ufsmm_state *state);

int ufsmm_canvas_render_region(struct ufsmm_canvas *canvas,
                               struct ufsmm_region *region);

int ufsmm_canvas_render_transition(struct ufsmm_canvas *canvas,
                                   struct ufsmm_transitions *t);

int ufsmm_canvas_render_one_transition(struct ufsmm_canvas *canvas,
                                       struct ufsmm_transition *t);
double ufsmm_canvas_get_scale(void);

int ufsmm_canvas_set_selection(bool active, double sx,
                                           double sy,
                                           double ex,
                                           double ey);
int ufsmm_canvas_pan(double dx, double dy);

int ufsmm_canvas_get_offset(double *x, double *y);

#endif  // CANVAS_VIEW_H_
