#include <math.h>
#include <ufsm/model.h>

#include "canvas/view.h"

int ufsmm_canvas_render_region(struct ufsmm_canvas *canvas,
                               struct ufsmm_region *region)
{
    double x, y, w, h;
    double dashes[] = {10.0,  /* ink */
                       10.0};  /* skip */
    cairo_t *cr = canvas->cr;

    if (region->draw_as_root)
        return UFSMM_OK;

    ufsmm_get_region_absolute_coords(region, &x, &y, &w, &h);

    if (region->focus || region->off_page) {
        cairo_save (cr);
        cairo_set_font_size (cr, 18);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_move_to (cr, x + 10, y + 25);
        cairo_show_text (cr, region->name);
        cairo_restore(cr);
    }

    if (region->focus) {
        cairo_save(cr);
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        cairo_set_dash (cr, dashes, 2, 0);
        cairo_set_line_width (cr, 2);
        cairo_rectangle (cr, x, y, w, h);
        cairo_stroke (cr);
        cairo_restore (cr);
    } else if (TAILQ_NEXT(region, tailq)) {
        if (!TAILQ_NEXT(region, tailq)->focus) {
            cairo_save(cr);
            ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
            cairo_set_dash(cr, dashes, 2, 0);
            cairo_set_line_width (cr, 2);
            cairo_move_to(cr, x, y + h);
            cairo_line_to(cr, x+w, y+h);
            cairo_stroke(cr);
            cairo_restore(cr);
        }
    }

    /* Possibly render region 'off-page' symbol */
    if (region->off_page && !region->draw_as_root) {
        cairo_save(cr);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        /* Render two, filled circles */
        cairo_new_sub_path(cr);
        cairo_translate(cr, x + w - 50, y - 20 + h);
        cairo_arc(cr, 0, 0, 5, 0, 2 * M_PI);
        cairo_translate(cr, 20, 0);
        cairo_arc(cr, 0, 0, 5, 0, 2 * M_PI);
        cairo_fill(cr);
        cairo_close_path(cr);
        cairo_restore(cr);
        /* and the line between them */
        cairo_save(cr);
        cairo_move_to (cr,  x + w - 50, y + h - 20);
        cairo_line_to(cr, x + w - 30, y + h - 20);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_set_line_width (cr, 2.0);
        cairo_stroke(cr);
        cairo_restore(cr);
    }

    /* Render resize boxes */
    if (region->focus) {
        cairo_save(cr);
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        cairo_rectangle (cr, x + w/2 - 5, y - 5, 10, 10);
        cairo_rectangle (cr, x + w/2 - 5, y + h - 5 , 10, 10);
        cairo_fill(cr);
        cairo_restore(cr);
    }

    return 0;
}

int ufsmm_region_get_at_xy(struct ufsmm_canvas *canvas,
                           struct ufsmm_region *region, double px, double py,
                           struct ufsmm_region **out, int *depth)
{
    int d = 0;
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    bool found_region = false;
    double x, y, w, h;
    double ox, oy;
    cairo_t *cr = canvas->cr;

    if (!region)
        return -UFSMM_ERROR;

    ox = canvas->current_region->ox / canvas->current_region->scale;
    oy = canvas->current_region->oy / canvas->current_region->scale;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r->off_page && !r->draw_as_root)
            continue;
        d++;

        ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);

        x += ox;
        y += oy;

        if ( (px > (x-5)) && (px < (x + w + 5)) &&
             (py > (y-5)) && (py < (y + h + 5))) {

             (*out) = r;
             found_region = true;
        }

        TAILQ_FOREACH(s, &r->states, tailq) {
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
