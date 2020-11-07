#include <stdio.h>
#include <math.h>
#include <ufsm/model.h>

#include "canvas/view.h"

int transition_calc_begin_end_point(struct ufsmm_state *s,
                                    enum ufsmm_side side,
                                    double offset,
                                    double *x,
                                    double *y)
{
    double sx, sy, sw, sh;

    ufsmm_get_state_absolute_coords(s, &sx, &sy, &sw, &sh);

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
            break;
        }
    } else if (s->kind == UFSMM_STATE_INIT) {
        (*x) = sx + sw/2;
        (*y) = sy + sh;
    }
}

int ufsmm_canvas_render_transition(cairo_t *cr,
                                  struct ufsmm_transition *transitions)
{
    const double dashes[] = {10.0,  /* ink */
                             10.0};  /* skip */
    double begin_x, begin_y, end_x, end_y;
    cairo_text_extents_t extents;

    if (transitions == NULL)
        return UFSMM_OK;

    for (struct ufsmm_transition *t = transitions; t; t = t->next) {

        transition_calc_begin_end_point(t->source.state,
                             t->source.side,
                             t->source.offset,
                             &begin_x, &begin_y);

        transition_calc_begin_end_point(t->dest.state,
                             t->dest.side,
                             t->dest.offset,
                             &end_x, &end_y);

        struct ufsmm_vertice *v;

        double rx, ry, rw, rh;

        ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                        &rx, &ry, &rw, &rh);

        cairo_save(cr);
        cairo_move_to (cr, begin_x, begin_y);
        cairo_set_line_width (cr, 2.0);

        for (v = t->vertices; v; v = v->next) {
            cairo_line_to(cr, v->x, v->y);
            //cairo_set_source_rgb (cr, 0, 0, 0);
            ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
            cairo_stroke (cr);
            cairo_move_to (cr, v->x, v->y);
            begin_x = v->x;
            begin_y = v->y;
        }

        cairo_line_to(cr, end_x, end_y);
        //cairo_set_source_rgb (cr, 0, 0, 0);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_set_line_width (cr, 2.0);
        cairo_stroke (cr);
        cairo_restore(cr);

        /* Draw arrow */
        double angle = atan2 (end_y - begin_y, end_x - begin_x) + M_PI;

        double x1 = end_x + 15 * cos(angle - 0.4);
        double y1 = end_y + 15 * sin(angle - 0.4);
        double x2 = end_x + 15 * cos(angle + 0.4);
        double y2 = end_y + 15 * sin(angle + 0.4);

        cairo_save(cr);

        //cairo_set_source_rgb (cr, 0, 0, 0);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_new_sub_path(cr);
        cairo_move_to (cr, end_x, end_y);
        cairo_line_to(cr, x1, y1);
        cairo_line_to(cr, x2, y2);
        cairo_close_path(cr);
        cairo_fill(cr);
        cairo_restore(cr);

        /* Draw text box */
        char text[1024];
        cairo_save(cr);
        cairo_set_font_size (cr, 18);
        //cairo_set_source_rgb (cr, 0,0,0);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);

        enum ufsmm_state_kind source_kind = t->source.state->kind;

        if (source_kind == UFSMM_STATE_NORMAL) {
            snprintf(text, sizeof(text), "%s [%s] / %s",
                        t->trigger?t->trigger->name:"completion-event", "", "");
        } else if (source_kind == UFSMM_STATE_INIT) {
            snprintf(text, sizeof(text), "/ %s", "");
        }

        cairo_text_extents (cr, text, &extents);
        cairo_move_to (cr, rx + t->text_block_coords.x,
                           ry + t->text_block_coords.y + extents.height);
        cairo_show_text (cr, text);
        cairo_restore(cr);

        /* Draw selection boxes if focused */

        if (t->focus) {
            double fbx, fby;

            transition_calc_begin_end_point(t->source.state,
                                 t->source.side,
                                 t->source.offset,
                                 &fbx, &fby);

            cairo_save(cr);
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
            cairo_rectangle (cr, fbx - 5, fby - 5, 10, 10);
            cairo_fill(cr);

            cairo_move_to (cr, fbx, fby);

            for (v = t->vertices; v; v = v->next) {
                cairo_rectangle (cr, v->x - 5, v->y - 5, 10, 10);
                cairo_fill(cr);
                cairo_move_to (cr, v->x, v->y);
                fbx = v->x;
                fby = v->y;
            }

            cairo_rectangle (cr, end_x - 5, end_y - 5, 10, 10);
            cairo_fill(cr);
            cairo_restore(cr);

            /* Dashed rectangle around the text block */
            double tx, ty, th, tw;
            tx = t->text_block_coords.x;
            ty = t->text_block_coords.y;
            th = t->text_block_coords.h;
            tw = t->text_block_coords.w;

            cairo_save(cr);
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
            cairo_set_dash (cr, dashes, 2, 0);
            cairo_set_line_width (cr, 2);
            cairo_rectangle (cr, tx, ty, tw, th);
            cairo_stroke (cr);
            cairo_restore (cr);
            /* Draw resize boxes for the text block */

            cairo_save(cr);
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
            cairo_rectangle (cr, tx - 5, ty - 5, 10, 10);
            cairo_rectangle (cr, tx + tw - 5, ty - 5, 10, 10);
            cairo_rectangle (cr, tx + tw - 5, ty + th - 5, 10, 10);
            cairo_rectangle (cr, tx - 5, ty + th - 5, 10, 10);
            cairo_fill(cr);
            cairo_restore(cr);

        }

    }

    return UFSMM_OK;
}
