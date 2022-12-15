#include <math.h>
#include "model.h"
#include "utils.h"

bool ufsmm_region_is_root_or_offpage(struct ufsmm_region *r)
{
    if (r->off_page)
        return true;
    if (r->parent_state == NULL)
        return true;

    return false;
}

int ufsmm_get_region_absolute_coords(struct ufsmm_canvas *canvas,
                                     struct ufsmm_region *r, double *x,
                                                           double *y,
                                                           double *w,
                                                           double *h)
{
    struct ufsmm_state *ps;
    struct ufsmm_region *pr = r;
    double x_acc = 0.0;
    double y_acc = 30.0;

    if (r == NULL)
        return -UFSMM_ERROR;

    if (r->draw_as_root) {
        *x = 0;
        *y = 0;
        *w = ufsmm_paper_size_x(canvas->model->paper_size);
        *h = ufsmm_paper_size_y(canvas->model->paper_size);
        return UFSMM_OK;
    } else {
        if (r->parent_state) {
            y_acc += r->parent_state->region_y_offset + r->parent_state->y;
            x_acc += r->parent_state->x;
        }
    }

    /* Iterate through possible sibling regions */
    ps = r->parent_state;

    if (ps) {

        TAILQ_FOREACH(pr, &ps->regions, tailq) {
            if (pr == r)
                break;
            y_acc += pr->h;
        }
    }


    *x = x_acc;
    *y = y_acc;

    if (r->h == -1) {
        if (r->parent_state) {
            *h = r->parent_state->h - 30.0 - r->parent_state->region_y_offset;
        }
    } else {
        *h = r->h;
    }

    if (r->parent_state) {
        *w = r->parent_state->w;
    }

    return 0;
}

int ufsmm_region_get_at_xy(struct ufsmm_canvas *canvas,
                           struct ufsmm_region *region, double px, double py,
                           struct ufsmm_region **out, int *depth)
{
    return ufsmm_region_get_at_xy2(canvas, region, px, py, out, depth, NULL);
}

int ufsmm_region_get_at_xy2(struct ufsmm_canvas *canvas,
                           struct ufsmm_region *region, double px, double py,
                           struct ufsmm_region **out, int *depth,
                           struct ufsmm_state *skip_state)
{
    int d = 0;
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    bool found_region = false;
    double x, y, w, h;
    double ox, oy;

    if (!region)
        return -UFSMM_ERROR;

    ox = region->ox;
    oy = region->oy;

    ufsmm_stack_init(&stack);
    ufsmm_stack_push(stack, region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r->off_page && !r->draw_as_root)
            continue;
        d++;

        ufsmm_get_region_absolute_coords(canvas, r, &x, &y, &w, &h);

        x += ox;
        y += oy;

        if ( (px > (x-5)) && (px < (x + w + 5)) &&
             (py > (y-5)) && (py < (y + h + 5))) {

             (*out) = r;
             found_region = true;
        }

        TAILQ_FOREACH(s, &r->states, tailq) {
            if (s == skip_state)
                continue;
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);

    if (depth != NULL)
        (*depth) = d;

    if (found_region)
        return UFSMM_OK;
    else
        return -UFSMM_ERROR;
}

int ufsmm_state_get_closest_side(struct ufsmm_state *s,
                                 double px, double py,
                                 struct ufsmm_region *current_region,
                                 enum ufsmm_side *side, double *offset)
{
    double x, y, w, h;
    double d, d2;
    double lx, ly;

    x = s->x + current_region->ox;
    y = s->y + current_region->oy;
    w = s->w;
    h = s->h;

    /* Top segment */
    d = fabs(distance_point_to_seg2(px, py, x, y, x + w, y, &lx, &ly));
    *side = UFSMM_SIDE_TOP;
    *offset = ufsmm_canvas_nearest_grid_point(lx - x);

    /* Right segment */
    d2 = fabs(distance_point_to_seg2(px, py, x + w, y, x + w, y + h, &lx, &ly));

    if (d2 < d) {
        d = d2;
        *side = UFSMM_SIDE_RIGHT;
        *offset = ufsmm_canvas_nearest_grid_point(ly - y);
    }

    /* Bottom segment */
    d2 = fabs(distance_point_to_seg2(px, py, x, y + h, x + w, y + h, &lx, &ly));

    if (d2 < d) {
        d = d2;
        *side = UFSMM_SIDE_BOTTOM;
        *offset = ufsmm_canvas_nearest_grid_point(lx - x);
    }

    /* Left segment */
    d2 = fabs(distance_point_to_seg2(px, py, x, y, x, y + h, &lx, &ly));

    if (d2 < d) {
        d = d2;
        *side = UFSMM_SIDE_LEFT;
        *offset = ufsmm_canvas_nearest_grid_point(ly - y);
    }

    return UFSMM_OK;
}

int ufsmm_state_get_at_xy(struct ufsmm_region *region,
                          double px, double py,
                          struct ufsmm_state **out, int *depth)
{
    int d = 0;
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    bool found_state = false;
    double x, y, w, h;

    ufsmm_stack_init(&stack);
    ufsmm_stack_push(stack, region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r->off_page && !r->draw_as_root)
            continue;
        d++;

        TAILQ_FOREACH(s, &r->states, tailq) {
            x = s->x + region->ox;
            y = s->y + region->oy;
            w = s->w;
            h = s->h;

            if ( (px > (x-5)) && (px < (x + w + 5)) &&
                 (py > (y-5)) && (py < (y + h + 5))) {
                 (*out) = s;
                 found_state = true;
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    if (depth != NULL)
        (*depth) = d;

    if (found_state)
        return UFSMM_OK;
    else
        return -UFSMM_ERROR;
}

double distance_point_to_seg2(double px, double py,
                            double sx, double sy,
                            double ex, double ey,
                            double *x_out, double *y_out)
{
    double A = px - sx;
    double B = py - sy;
    double C = ex - sx;
    double D = ey - sy;

    double dot = A * C + B * D;
    double len_sq = C * C + D * D;
    double param = -1;

    if (len_sq != 0) //in case of 0 length line
        param = dot / len_sq;

    double xx, yy;

    if (param < 0) {
        xx = sx;
        yy = sy;
    } else if (param > 1) {
        xx = ex;
        yy = ey;
    } else {
        xx = sx + param * C;
        yy = sy + param * D;
    }

    double dx = px - xx;
    double dy = py - yy;
/*
    printf("distance from <%f, %f> to line <<%f, %f>, <%f, %f>>\n",
            px, py, sx, sy, ex, ey);
*/

    if (x_out)
        *x_out = xx;
    if (y_out)
        *y_out = yy;

    return sqrt(dx * dx + dy * dy);
}


double distance_point_to_seg(double px, double py,
                            double sx, double sy,
                            double ex, double ey)
{
    return distance_point_to_seg2(px, py, sx, sy, ex, ey, NULL, NULL);
}

int transition_calc_begin_end_point(struct ufsmm_state *s,
                                    enum ufsmm_side side,
                                    double offset,
                                    double *x,
                                    double *y)
{
    double sx, sy, sw, sh;
    int rc = 0;

    sx = s->x;
    sy = s->y;
    sw = s->w;
    sh = s->h;

    if (s->kind == UFSMM_STATE_NORMAL) {
        switch (side) {
            case UFSMM_SIDE_LEFT:
                (*x) = sx;
                (*y) = sy + ((offset > sh)?sh:offset);
            break;
            case UFSMM_SIDE_RIGHT:
                (*x) = sx + sw;
                (*y) = sy + ((offset > sh)?sh:offset);
            break;
            case UFSMM_SIDE_TOP:
                (*x) = sx + ((offset > sw)?sw:offset);
                (*y) = sy;
            break;
            case UFSMM_SIDE_BOTTOM:
                (*x) = sx + ((offset > sw)?sw:offset);
                (*y) = sy + sh;
            break;
            default:
                rc = -1;
            break;
        }
    } else if ((s->kind == UFSMM_STATE_INIT) || (s->kind == UFSMM_STATE_FINAL) ||
               (s->kind == UFSMM_STATE_SHALLOW_HISTORY) ||
               (s->kind == UFSMM_STATE_DEEP_HISTORY) ||
               (s->kind == UFSMM_STATE_TERMINATE)) {

        switch (side) {
            case UFSMM_SIDE_LEFT:
                (*x) = sx;
                (*y) = sy + sh/2;
            break;
            case UFSMM_SIDE_RIGHT:
                (*x) = sx + sw;
                (*y) = sy + sh/2;
            break;
            case UFSMM_SIDE_TOP:
                (*x) = sx + sw/2;
                (*y) = sy;
            break;
            case UFSMM_SIDE_BOTTOM:
                (*x) = sx + sw/2;
                (*y) = sy + sh;
            break;
            default:
                rc = -1;
            break;
        }
    } else if ((s->kind == UFSMM_STATE_JOIN) || (s->kind == UFSMM_STATE_FORK)) {
        switch (side) {
            case UFSMM_SIDE_LEFT:
                (*x) = sx;
                (*y) = sy + ((offset > sh)?sh:offset);
            break;
            case UFSMM_SIDE_RIGHT:
                (*x) = sx + sw;
                (*y) = sy + ((offset > sh)?sh:offset);
            break;
            case UFSMM_SIDE_TOP:
                (*x) = sx + ((offset > sw)?sw:offset);
                (*y) = sy;
            break;
            case UFSMM_SIDE_BOTTOM:
                (*x) = sx + ((offset > sw)?sw:offset);
                (*y) = sy + sh;
            break;
            default:
                rc = -1;
            break;
        }
    }

    return rc;
}

double ufsmm_canvas_nearest_grid_point(double in)
{
    return (int)(round(in / 10)) * 10;
}

int ufsmm_paper_size(enum ufsmm_paper_size paper_size, int *x, int *y)
{
    int rc = 0;

    switch (paper_size) {
        case UFSMM_PAPER_SIZE_A4:
            (*x) = 1684;
            (*y) = 1190;
        break;
        case UFSMM_PAPER_SIZE_A3:
            (*x) = 2380;
            (*y) = 1684;
        break;
        case UFSMM_PAPER_SIZE_A2:
            (*x) = 3368;
            (*y) = 2380;
        break;
        case UFSMM_PAPER_SIZE_A1:
            (*x) = 4768;
            (*y) = 3368;
        break;
        default:
            rc = -1;
    };

    return rc;
}

int ufsmm_paper_size_x(enum ufsmm_paper_size paper_size)
{
    int x, y;

    if (ufsmm_paper_size(paper_size, &x, &y) != 0)
        return 0;

    return x;
}

int ufsmm_paper_size_y(enum ufsmm_paper_size paper_size)
{
    int x, y;

    if (ufsmm_paper_size(paper_size, &x, &y) != 0)
        return 0;

    return y;
}

/* Detection box centered around <x, y>*/
bool point_in_box(double px, double py,
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
bool point_in_box2(double px, double py,
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
bool point_in_box3(double px, double py,
                         double x, double y,
                         double x2, double y2)
{
    if ( (px > x) && (px < x2) &&
         (py > y) && (py < y2)) {
        return true;
    }

    return false;
}
