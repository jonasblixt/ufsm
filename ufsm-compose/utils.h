#ifndef UFSMM_UTILS_H
#define UFSMM_UTILS_H

#include <ufsm/model.h>
#include "controller.h"

/* Detection box centered around <x, y>*/
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

/* Detection box from <x, y> to <x + w, y + h> */
inline bool point_in_box2(double px, double py,
                         double x, double y,
                         double w, double h)
{
    if ( (px > x) && (px < (x + w)) &&
         (py > y) && (py < (y + h))) {
        return true;
    }

    return false;
}

/* Detection box from <x, y> to <x2, y2> */
inline bool point_in_box3(double px, double py,
                         double x, double y,
                         double x2, double y2)
{
    if ( (px > x) && (px < x2) &&
         (py > y) && (py < y2)) {
        return true;
    }

    return false;
}

int ufsmm_region_get_at_xy(struct ufsmm_canvas *canvas,
                           struct ufsmm_region *region, double px, double py,
                           struct ufsmm_region **out, int *depth);

int ufsmm_get_region_absolute_coords(struct ufsmm_canvas *canvas,
                                    struct ufsmm_region *r, double *x,
                                                           double *y,
                                                           double *w,
                                                           double *h);

bool ufsmm_region_is_root_or_offpage(struct ufsmm_region *r);

int ufsmm_state_get_closest_side(struct ufsmm_state *s,
                                 double px, double py,
                                 struct ufsmm_region *current_region,
                                 enum ufsmm_side *side, double *offset);

int ufsmm_state_get_at_xy(struct ufsmm_region *region,
                          double px, double py,
                          struct ufsmm_state **out, int *depth);

double distance_point_to_seg(double px, double py,
                            double sx, double sy,
                            double ex, double ey);

double distance_point_to_seg2(double px, double py,
                            double sx, double sy,
                            double ex, double ey,
                            double *x_out, double *y_out);

int transition_calc_begin_end_point(struct ufsmm_state *s,
                                    enum ufsmm_side side,
                                    double offset,
                                    double *x,
                                    double *y);

double ufsmm_canvas_nearest_grid_point(double in);

bool ufsmm_has_parent_state(struct ufsmm_state *state,
                            struct ufsmm_state *possible_parent);

int ufsmm_paper_size(enum ufsmm_paper_size paper_size, int *x, int *y);

int ufsmm_paper_size_x(enum ufsmm_paper_size paper_size);
int ufsmm_paper_size_y(enum ufsmm_paper_size paper_size);
#endif
