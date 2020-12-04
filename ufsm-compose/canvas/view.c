#include <stdio.h>
#include <math.h>
#include <ufsm/model.h>

#include "canvas/view.h"

static double selection_sx;
static double selection_sy;
static double selection_ex;
static double selection_ey;
static bool draw_selection;

bool ufsmm_region_is_root_or_offpage(struct ufsmm_region *r)
{
    if (r->off_page)
        return true;
    if (r->parent_state == NULL)
        return true;

    return false;
}

int ufsmm_get_region_absolute_coords(struct ufsmm_region *r, double *x,
                                                           double *y,
                                                           double *w,
                                                           double *h)
{
    struct ufsmm_state *ps;
    struct ufsmm_region *pr = r;
    double x_acc = 0.0;
    double y_acc = 0.0;

    if (r == NULL)
        return -UFSMM_ERROR;

    if (r->draw_as_root) {
        *x = 0;
        *y = 0;
        *h = 1190;
        *w = 1684;
        return UFSMM_OK;
    } else {
        y_acc += r->parent_state->region_y_offset;
    }

    /* Calculate offsets to current state */
    while (pr) {
        if (!pr->parent_state)
            break;
        ps = pr->parent_state;

        x_acc += ps->x;
        y_acc += ps->y + 30.0;

        pr = ps->parent_region;

        if (ufsmm_region_is_root_or_offpage(pr))
            break;

    }

    /* Iterate through possible sibling regions */
    ps = r->parent_state;

    if (ps) {
        pr = ps->regions;

        while (pr) {
            if (pr == r)
                break;
            y_acc += pr->h;
            pr = pr->next;
        }
    }


    *x = x_acc;
    *y = y_acc;

    if (r->h == -1) {
        *h = r->parent_state->h - 30.0 - r->parent_state->region_y_offset;
    } else {
        *h = r->h;
    }
    *w = r->parent_state->w;

    return 0;
}

int ufsmm_get_state_absolute_coords(struct ufsmm_state *s, double *x,
                                                         double *y,
                                                         double *w,
                                                         double *h)
{
    struct ufsmm_state *ps = s;
    struct ufsmm_region *pr;
    double x_acc = 0.0;
    double y_acc = 0.0;

    while (ps) {
      x_acc += ps->x;
      y_acc += ps->y;

      pr = ps->parent_region;

      if (ufsmm_region_is_root_or_offpage(pr))
        break;

      ps = pr->parent_state;

      if (ps) {
        y_acc += 30.0;
      }
    }

    *x = x_acc;
    *y = y_acc;
    *w = s->w;
    *h = s->h;
    return 0;
}

int ufsmm_canvas_render(struct ufsmm_canvas *canvas, int width, int height)
{
    int rc;
    double x, y, w, h;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    static struct ufsmm_stack *stack;

    cairo_translate(canvas->cr, canvas->ox, canvas->oy);
    cairo_scale(canvas->cr, canvas->scale, canvas->scale);

    ufsmm_canvas_render_grid(canvas->cr, 1684, 1190);

    rc = ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    if (rc != UFSMM_OK)
        return rc;

    /* Pass 1: draw states, regions etc*/
    rc = ufsmm_stack_push(stack, (void *) canvas->current_region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        ufsmm_canvas_render_region(canvas, r);

        if (r->off_page && (!r->draw_as_root))
            continue;

        for (s = r->state; s; s = s->next)
        {
            ufsmm_canvas_render_state(canvas, s);

            for (r2 = s->regions; r2; r2 = r2->next)
            {
                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    /* Pass 2: draw transitions */
    rc = ufsmm_stack_push(stack, (void *) canvas->current_region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        for (s = r->state; s; s = s->next)
        {
            ufsmm_canvas_render_transition(canvas->cr, s->transition);
            for (r2 = s->regions; r2; r2 = r2->next)
            {
                if (r2->off_page)
                    continue;

                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    ufsmm_stack_free(stack);

    /* Draw selection overlay */

    double dashes[] = {10.0,  /* ink */
                       20.0};  /* skip */

    if (draw_selection) {
        cairo_save(canvas->cr);
        //cairo_set_source_rgb (cr, 0.4, 0.4, 0.4);
        ufsmm_color_set(canvas->cr, UFSMM_COLOR_ACCENT);
        cairo_set_dash (canvas->cr, dashes, 2, 0);
        cairo_set_line_width (canvas->cr, 1);
        cairo_rectangle (canvas->cr, selection_sx,
                             selection_sy,
                             selection_ex - selection_sx,
                             selection_ey - selection_sy);
        cairo_stroke (canvas->cr);
        cairo_restore (canvas->cr);
    }
    return rc;
}

int ufsmm_canvas_set_selection(bool active, double sx,
                                           double sy,
                                           double ex,
                                           double ey)
{
    draw_selection = active;
    selection_sx = sx;
    selection_sy = sy;
    selection_ex = ex;
    selection_ey = ey;
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
