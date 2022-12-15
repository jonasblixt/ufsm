#ifndef CANVAS_VIEW_H_
#define CANVAS_VIEW_H_

#include <stdint.h>
#include <cairo/cairo.h>
#include "controller.h"
#include "model/model.h"

#ifndef M_PI
#define M_PI		3.14159265358979323846
#endif

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
                               struct ufsmm_region *region,
                               bool nav_mode);

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
