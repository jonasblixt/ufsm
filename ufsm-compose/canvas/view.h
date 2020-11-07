#ifndef CANVAS_VIEW_H_
#define CANVAS_VIEW_H_

#include <stdint.h>
#include <ufsm/model.h>
#include <cairo/cairo.h>

enum ufsmm_color {
    UFSMM_COLOR_BG,
    UFSMM_COLOR_GRID,
    UFSMM_COLOR_NORMAL,
    UFSMM_COLOR_ACCENT
};

enum ufsmm_paper_size {
    UFSMM_PAPER_SIZE_INVALID,
    UFSMM_PAPER_SIZE_A4,
    UFSMM_PAPER_SIZE_A3,
    UFSMM_PAPER_SIZE_A2,
    UFSMM_PAPER_SIZE_A1,
};

enum ufsmm_state_resize_selector {
    UFSMM_NO_SELECTION,
    UFSMM_TOP_LEFT,
    UFSMM_TOP_MIDDLE,
    UFSMM_TOP_RIGHT,
    UFSMM_RIGHT_MIDDLE,
    UFSMM_BOT_RIGHT,
    UFSMM_BOT_MIDDLE,
    UFSMM_BOT_LEFT,
    UFSMM_LEFT_MIDDLE
};

enum ufsmm_transition_vertice_selector {
    UFSMM_TRANS_NO_SELECTION,
    UFSMM_TRANS_BEGIN,
    UFSMM_TRANS_VERT,
    UFSMM_TRANS_END,
};

inline bool point_in_box(double px, double py,
                         double x, double y,
                         double w, double h)
{
    if ( (px > (x - w/2)) && (px < (x + w/2)) &&
         (py > (y - h/2)) && (py < (y + h/2))) {
        return true;
    }

    return false;
}

int ufsmm_color_set(cairo_t *cr, enum ufsmm_color color);

int ufsmm_canvas_render(cairo_t *cr, struct ufsmm_region *root,
                        int widht, int height);
int ufsmm_canvas_render_grid(cairo_t *cr, int width, int height);
int ufsmm_canvas_render_state(cairo_t *cr, struct ufsmm_state *state);
int ufsmm_canvas_render_region(cairo_t *cr, struct ufsmm_region *region);
int ufsmm_canvas_render_transition(cairo_t *cr, struct ufsmm_transition *t);
int ufsmm_canvas_scale(double zoom_change);
double ufsmm_canvas_get_scale(void);

int ufsmm_get_state_absolute_coords(struct ufsmm_state *s, double *x,
                                                         double *y,
                                                         double *w,
                                                         double *h);

int ufsmm_get_region_absolute_coords(struct ufsmm_region *r, double *x,
                                                           double *y,
                                                           double *w,
                                                           double *h);

bool ufsmm_region_is_root_or_offpage(struct ufsmm_region *r);

double ufsmm_canvas_nearest_grid_point(double in);
int ufsmm_canvas_state_translate(struct ufsmm_state *s, double dx, double dy);
int transition_calc_begin_end_point(struct ufsmm_state *s,
                                    enum ufsmm_side side,
                                    double offset,
                                    double *x,
                                    double *y);

int ufsmm_canvas_set_selection(bool active, double sx,
                                           double sy,
                                           double ex,
                                           double ey);
int ufsmm_canvas_pan(double dx, double dy);

int ufsmm_canvas_get_offset(double *x, double *y);


int ufsmm_state_get_at_xy(struct ufsmm_region *r, double px, double py,
                            struct ufsmm_state **out, int *depth);

int ufsmm_state_get_closest_side(struct ufsmm_state *s, double px, double py,
                                    enum ufsmm_side *side, double *offset);

double distance_point_to_seg(double px, double py,
                            double sx, double sy,
                            double ex, double ey);

double distance_point_to_seg2(double px, double py,
                            double sx, double sy,
                            double ex, double ey,
                            double *x_out, double *y_out);
#endif  // CANVAS_VIEW_H_
