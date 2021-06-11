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
            break;
        }
    }
}

static void render_selection_boxes(cairo_t *cr, struct ufsmm_transition *t)
{
    double fbx, fby;
    double rx, ry, rw, rh;
    struct ufsmm_vertice *v;
    double begin_x, begin_y, end_x, end_y;
    const double dashes[] = {10.0,  /* ink */
                             10.0};  /* skip */
    struct ufsmm_region *pr = t->source.state->parent_region;
    ufsmm_get_region_absolute_coords(pr, &rx, &ry, &rw, &rh);

    transition_calc_begin_end_point(t->source.state,
                         t->source.side,
                         t->source.offset,
                         &fbx, &fby);

    transition_calc_begin_end_point(t->dest.state,
                         t->dest.side,
                         t->dest.offset,
                         &end_x, &end_y);
    cairo_save(cr);
    ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
    cairo_rectangle (cr, fbx - 5, fby - 5, 10, 10);
    cairo_fill(cr);

    cairo_move_to (cr, fbx, fby);

    TAILQ_FOREACH(v, &t->vertices, tailq) {
        cairo_rectangle (cr, rx + v->x - 5, ry + v->y - 5, 10, 10);
        cairo_fill(cr);
        cairo_move_to (cr, rx + v->x, ry + v->y);
        fbx = rx + v->x;
        fby = ry + v->y;
    }

    cairo_rectangle (cr, end_x - 5, end_y - 5, 10, 10);
    cairo_fill(cr);
    cairo_restore(cr);

    /* Dashed rectangle around the text block */

    transition_calc_begin_end_point(t->source.state,
                         t->source.side,
                         t->source.offset,
                         &fbx, &fby);

    double tx, ty, th, tw;
    tx = t->text_block_coords.x + fbx;
    ty = t->text_block_coords.y + fby;
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

/*
static void render_transition_text(cairo_t *cr, struct ufsmm_transition *t)
{
    char text[1024];
    size_t text_pos = 0;
    cairo_text_extents_t extents;
    double rx, ry, rw, rh;

    cairo_save(cr);
    cairo_set_font_size (cr, 14);
    ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);

    ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                    &rx, &ry, &rw, &rh);

    enum ufsmm_state_kind source_kind = t->source.state->kind;
    if (source_kind == UFSMM_STATE_INIT) {
            snprintf(text, sizeof(text), "/ %s", "");
    } else {
        if (t->trigger) {
            text_pos = sprintf(&text[text_pos], "%s", t->trigger->name);
        } else {
            text_pos = sprintf(&text[text_pos], "trigger-less");
        }

        text_pos += sprintf(&text[text_pos], " [");
        for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next) {
            text_pos += sprintf(&text[text_pos], "%s%s",
                        ar->act->name, ar->next?", ":"");
        }
        text_pos += sprintf(&text[text_pos], "] / ");

        for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next) {
            text_pos += sprintf(&text[text_pos], "%s%s",
                        ar->act->name, ar->next?", ":"");
        }
    }

    cairo_text_extents (cr, text, &extents);
    cairo_move_to (cr, rx + t->text_block_coords.x,
                       ry + t->text_block_coords.y + extents.height);
    cairo_show_text (cr, text);
    cairo_restore(cr);
}
*/

static void render_transition_text(cairo_t *cr, struct ufsmm_transition *t)
{
    size_t text_pos = 0;
    char text_buf[1024];
    cairo_text_extents_t extents;
    double rx, ry, rw, rh;
    double tx, ty, tw, th;
    unsigned int line_no = 0;
    const char *text_ptr = NULL;
    struct ufsmm_action_ref *ar;

    cairo_save(cr);
    cairo_set_font_size (cr, 14);
    ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);

    transition_calc_begin_end_point(t->source.state,
                         t->source.side,
                         t->source.offset,
                         &rx,
                         &ry);

    tx = t->text_block_coords.x;
    ty = t->text_block_coords.y;
    tw = t->text_block_coords.w;
    th = t->text_block_coords.h;

    double x = rx + tx;
    double y = ry + ty + 20;
    double x_space = tw;

    enum ufsmm_state_kind source_kind = t->source.state->kind;

    if (t->trigger) {
        text_ptr = t->trigger->name;
    } else {
        text_ptr = "trigger-less";
    }

    cairo_text_extents (cr, text_ptr, &extents);
    cairo_move_to (cr, x, y);
    cairo_show_text (cr, text_ptr);
    x_space -= extents.width;
    x += extents.width + 10;

    TAILQ_FOREACH(ar, &t->guards, tailq) {
        if ((ar == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(ar, tailq))
            sprintf(text_buf, "[%s(), ", ar->act->name);
        else if ((ar == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(ar, tailq) == NULL))
            sprintf(text_buf, "[%s()]", ar->act->name);
        else if (TAILQ_NEXT(ar, tailq) == NULL)
            sprintf(text_buf, "%s()]", ar->act->name);
        else
            sprintf(text_buf, "%s(), ", ar->act->name);

        cairo_text_extents (cr, text_buf, &extents);
        x_space -= (extents.width + 10);

        if (x_space < 10) {
            line_no++;
            x_space = tw;
            x = rx + tx;
        }

        y = ry + ty + 20 + 20 * line_no;

        ar->x = x;
        ar->y = y - extents.height / 2;
        ar->w = extents.width;
        ar->h = extents.height;

        if (!t->focus)
            ar->focus = false;

        cairo_move_to (cr, x, y);
        if (ar->focus)
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        else
            ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_show_text (cr, text_buf);

        x += extents.width + 10;

    }

    TAILQ_FOREACH(ar, &t->actions, tailq) {
        if ((ar == TAILQ_FIRST(&t->actions)) && TAILQ_NEXT(ar, tailq))
            sprintf(text_buf, " / %s(), ", ar->act->name);
        else if ((ar == TAILQ_FIRST(&t->actions)) && (TAILQ_NEXT(ar, tailq) == NULL))
            sprintf(text_buf, " / %s()", ar->act->name);
        else if (TAILQ_NEXT(ar, tailq))
            sprintf(text_buf, "%s(), ", ar->act->name);
        else
            sprintf(text_buf, "%s()", ar->act->name);

        cairo_text_extents (cr, text_buf, &extents);
        x_space -= (extents.width + 10);

        if (x_space < 10) {
            line_no++;
            x_space = tw;
            x = rx + tx;
        }

        y = ry + ty + 20 + 20 * line_no;

        ar->x = x;
        ar->y = y - extents.height / 2;
        ar->w = extents.width;
        ar->h = extents.height;

        if (!t->focus)
            ar->focus = false;

        cairo_move_to (cr, x, y);

        if (ar->focus)
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        else
            ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_show_text (cr, text_buf);

        x += extents.width + 10;

    }

    cairo_restore(cr);
}

int ufsmm_canvas_render_one_transition(struct ufsmm_canvas *canvas,
                                       struct ufsmm_transition *t)
{
    double begin_x, begin_y, end_x, end_y;
    cairo_text_extents_t extents;
    struct ufsmm_vertice *v;
    cairo_t *cr = canvas->cr;
    double rx, ry, rw, rh;

    transition_calc_begin_end_point(t->source.state,
                         t->source.side,
                         t->source.offset,
                         &begin_x, &begin_y);

    if (t->dest.state) {
        transition_calc_begin_end_point(t->dest.state,
                             t->dest.side,
                             t->dest.offset,
                             &end_x, &end_y);
    } else {
        double ox = canvas->current_region->ox;
        double oy = canvas->current_region->oy;
        end_x = ufsmm_canvas_nearest_grid_point(canvas->px - ox);
        end_y = ufsmm_canvas_nearest_grid_point(canvas->py - oy);
    }

    ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                    &rx, &ry, &rw, &rh);

    cairo_save(cr);
    cairo_move_to (cr, begin_x, begin_y);
    cairo_set_line_width (cr, 2.0);

    double y_off = 0.0;
    struct ufsmm_state *ps = NULL;
    /*
    if (t->source.state->parent_region) {
        if (t->source.state->parent_region->parent_state) {
            ps = t->source.state->parent_region->parent_state;
            y_off = ps->region_y_offset;
        }
    }*/

    TAILQ_FOREACH(v, &t->vertices, tailq) {
        cairo_line_to(cr, v->x + rx, v->y + ry - y_off);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_stroke (cr);
        cairo_move_to (cr, v->x + rx, v->y + ry - y_off);
        begin_x = v->x + rx;
        begin_y = v->y + ry - y_off;
    }

    cairo_line_to(cr, end_x, end_y);

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

    ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_new_sub_path(cr);
    cairo_move_to (cr, end_x, end_y);
    cairo_line_to(cr, x1, y1);
    cairo_line_to(cr, x2, y2);
    cairo_close_path(cr);
    cairo_fill(cr);
    cairo_restore(cr);

    render_transition_text(cr, t);

    if (t->dest.state) {
        /* Draw selection boxes if focused */
        if (t->focus)
            render_selection_boxes(cr, t);
    }
}

int ufsmm_canvas_render_transition(struct ufsmm_canvas *canvas,
                                  struct ufsmm_transitions *transitions)
{
    struct ufsmm_transition *t;

    if (transitions == NULL)
        return UFSMM_OK;

    TAILQ_FOREACH(t, transitions, tailq) {
        ufsmm_canvas_render_one_transition(canvas, t);
    }

    return UFSMM_OK;
}
