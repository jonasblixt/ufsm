#include <stdio.h>
#include <string.h>
#include <math.h>
#include <ufsm/model.h>

#include "canvas/view.h"


static int render_history_state(struct ufsmm_canvas *canvas,
                                struct ufsmm_state *state,
                                bool deep)
{
    double x, y, w, h;
    double lbl_x, lbl_y;
    double radius = 10.0;
    double degrees = M_PI / 180.0;
    bool clip_text = false;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;

    ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->focus)
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
    else
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, UFSMM_COLOR_BG);
    cairo_fill(cr);
    cairo_restore(cr);

    cairo_save(cr);
    ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_set_line_width(cr, 2);
    cairo_move_to(cr, x + w/2 - 3, y + h/2 - 5);
    cairo_line_to(cr, x + w/2 - 3, y + h/2 + 5);

    cairo_move_to(cr, x + w/2 + 3, y + h/2 - 5);
    cairo_line_to(cr, x + w/2 + 3, y + h/2 + 5);

    cairo_move_to(cr, x + w/2 - 3, y + h/2);
    cairo_line_to(cr, x + w/2 + 3, y + h/2);

    cairo_stroke(cr);
    cairo_restore(cr);
    return 0;
}

static int render_init_state(struct ufsmm_canvas *canvas,
                             struct ufsmm_state *state)
{
    double x, y, w, h;
    double lbl_x, lbl_y;
    double radius = 10.0;
    double degrees = M_PI / 180.0;
    bool clip_text = false;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;

    ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->focus)
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
    else
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, UFSMM_COLOR_BG);
    cairo_fill(cr);
    cairo_restore(cr);
/*
    cairo_save(cr);
    cairo_rectangle(cr, x, y, w, h);
    ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
    cairo_stroke(cr);
    cairo_restore(cr);
*/
    return 0;
}

static int render_final_state(struct ufsmm_canvas *canvas,
                              struct ufsmm_state *state)
{
    double x, y, w, h;
    double lbl_x, lbl_y;
    double radius = 10.0;
    double degrees = M_PI / 180.0;
    bool clip_text = false;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;

    ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->focus)
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
    else
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, UFSMM_COLOR_BG);
    cairo_fill(cr);
    cairo_restore(cr);

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->focus)
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
    else
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2 - 4, 0, 2 * M_PI);
    cairo_fill(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, UFSMM_COLOR_BG);
    cairo_fill(cr);
    cairo_restore(cr);

    return 0;
}

static int render_normal_state(struct ufsmm_canvas *canvas,
                               struct ufsmm_state *state)
{
    double x, y, w, h;
    double rx, ry, rw, rh;
    double lbl_x, lbl_y;
    double radius = 10.0;
    double degrees = M_PI / 180.0;
    bool clip_text = false;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;


    ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    //cairo_set_source_rgb (cr, 1, 1, 1);
    ufsmm_color_set(cr, UFSMM_COLOR_BG);
    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_arc(cr, x + w - radius,
                  y + radius,
                  radius, -90 * degrees, 0);

    cairo_arc(cr, x + w - radius,
                  y + h - radius,
                  radius, 0 * degrees, 90 * degrees);

    cairo_arc(cr, x + radius,
                  y + h - radius,
                  radius, 90 * degrees, 180 * degrees);

    cairo_arc(cr, x + radius,
                  y + radius, radius,
                  180 * degrees, 270 * degrees);

    cairo_close_path(cr);
    cairo_fill_preserve(cr);

    //cairo_set_source_rgb (cr, 0,0,0);
    ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);

    cairo_set_font_size (cr, 18);
    cairo_text_extents (cr, state->name, &extents);

    if (extents.width < state->w) {
        lbl_x = (x + w/2.0) - (extents.width/2 + extents.x_bearing);
    } else {
        /* Text extends beyond the header area, left adjust and clip*/
        lbl_x = (x + 10);
        clip_text = true;
    }

    lbl_y = (y + 15) - (extents.height/2 + extents.y_bearing);

    if (!clip_text) {
        cairo_move_to (cr, lbl_x, lbl_y);
        cairo_show_text (cr, state->name);
    }

    double y_offset = 0.0;

    if (TAILQ_FIRST(&state->entries) || TAILQ_FIRST(&state->exits)) {
        y_offset = 50.0;
        cairo_move_to (cr, x, y + 30);
        cairo_line_to(cr, x + w, y + 30);
    } else {
        y_offset = 30;
    }

    /* Render entry actions */
    struct ufsmm_action_ref *entry;
    char action_str_buf[128];

    cairo_save(cr);
    cairo_set_font_size (cr, 14);
    TAILQ_FOREACH(entry, &state->entries, tailq) {
        snprintf(action_str_buf, sizeof(action_str_buf),
                    "e/ %s()", entry->act->name);

        cairo_text_extents(cr, action_str_buf, &extents);
        entry->x = x + 10;
        entry->y = y + y_offset - extents.height;
        entry->w = extents.width;
        entry->h = extents.height;

/*
 * Debug selection box for action function
        cairo_save(cr);
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        cairo_set_line_width(cr, 1);
        cairo_rectangle(cr, entry->x, entry->y, entry->w, entry->h);
        cairo_stroke(cr);
        cairo_restore(cr);
*/
        if (entry->focus)
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        else
            ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);

        cairo_move_to(cr, x + 10, y + y_offset);
        cairo_show_text(cr, action_str_buf);
        y_offset += 20;
    }

    TAILQ_FOREACH(entry, &state->exits, tailq) {
        snprintf(action_str_buf, sizeof(action_str_buf),
                    "x/ %s()", entry->act->name);

        cairo_text_extents(cr, action_str_buf, &extents);
        entry->x = x + 10;
        entry->y = y + y_offset - extents.height;
        entry->w = extents.width;
        entry->h = extents.height;

        if (entry->focus)
            ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        else
            ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_move_to(cr, x + 10, y + y_offset);
        cairo_show_text(cr, action_str_buf);
        y_offset += 20;
    }

    if (TAILQ_FIRST(&state->regions)) {
        cairo_move_to (cr, x, y + y_offset);
        cairo_line_to(cr, x + w, y + y_offset);
    }

    cairo_restore(cr);
    //cairo_set_source_rgb (cr, 0, 0, 0);
    ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
    cairo_set_line_width (cr, 2.0);
    cairo_stroke (cr);
    cairo_restore (cr);

    if (clip_text) {
        cairo_save(cr);
        cairo_rectangle(cr, x+2, y+2, w-4, 28);
        cairo_clip(cr);
        cairo_move_to (cr, lbl_x, lbl_y);
        //cairo_set_source_rgb(cr, 0, 0, 0);
        ufsmm_color_set(cr, UFSMM_COLOR_NORMAL);
        cairo_set_font_size (cr, 18);
        cairo_show_text (cr, state->name);
        cairo_restore(cr);
    }

    if (state->focus) {
        cairo_save(cr);
        ufsmm_color_set(cr, UFSMM_COLOR_ACCENT);
        cairo_rectangle (cr, (x + w/2) - 5, y - 5, 10, 10);     /* Top */
        cairo_rectangle (cr, (x + w/2) - 5, y + h - 5, 10, 10); /* Bot */
        cairo_rectangle (cr, x - 5, (y + h/2) - 5, 10, 10);     /* Left */
        cairo_rectangle (cr, x + w - 5, (y + h/2) - 5, 10, 10);     /* Right */
        /* Corners */
        cairo_rectangle (cr, x - 5, y - 5, 10, 10);
        cairo_rectangle (cr, x + w - 5, y - 5, 10, 10);
        cairo_rectangle (cr, x + w - 5, y + h - 5, 10, 10);
        cairo_rectangle (cr, x - 5, y + h - 5, 10, 10);
        cairo_fill(cr);
        cairo_restore(cr);

    }


    state->region_y_offset = y_offset - 30.0;
}

int ufsmm_canvas_render_state(struct ufsmm_canvas *canvas,
                              struct ufsmm_state *state)
{
    int rc;

    switch (state->kind) {
        case UFSMM_STATE_NORMAL:
            rc = render_normal_state(canvas, state);
        break;
        case UFSMM_STATE_INIT:
            rc = render_init_state(canvas, state);
        break;
        case UFSMM_STATE_FINAL:
            rc = render_final_state(canvas, state);
        break;
        case UFSMM_STATE_SHALLOW_HISTORY:
            rc = render_history_state(canvas, state, false);
        break;
        case UFSMM_STATE_DEEP_HISTORY:
            rc = render_history_state(canvas, state, true);
        break;
    }
    return 0;
}

int ufsmm_canvas_state_translate(struct ufsmm_state *s, double dx, double dy)
{
    struct ufsmm_transition *t;
    s->x += dx;
    s->y += dy;

    TAILQ_FOREACH(t, &s->transitions, tailq) {
        if ((t->source.state == s) &&
            (t->dest.state == s)) {

            t->text_block_coords.x += dx;
            t->text_block_coords.y += dy;

            struct ufsmm_vertice *v;
            TAILQ_FOREACH(v, &t->vertices, tailq) {
                v->x += dx;
                v->y += dy;
            }
/*
            for (struct ufsmm_vertice *v = t->vertices; v; v = v->next) {
                v->x += dx;
                v->y += dy;
            }
*/
        }
    }
}

int ufsmm_state_get_at_xy(struct ufsmm_canvas *canvas,
                          struct ufsmm_region *region,
                          double px, double py,
                          struct ufsmm_state **out, int *depth)
{
    int d = 0;
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    bool found_state = false;
    double x, y, w, h;
    double ox, oy;
    cairo_t *cr = canvas->cr;

    ox = canvas->current_region->ox;
    oy = canvas->current_region->oy;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r->off_page && !r->draw_as_root)
            continue;
        d++;

        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_get_state_absolute_coords(s, &x, &y, &w, &h);

            x += ox;
            y += oy;

            if ( (px > (x-5)) && (px < (x + w + 5)) &&
                 (py > (y-5)) && (py < (y + h + 5))) {

                 L_DEBUG("State '%s' selected", s->name);
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

int ufsmm_state_get_closest_side(struct ufsmm_canvas *canvas,
                                 struct ufsmm_state *s,
                                 enum ufsmm_side *side, double *offset)
{
    double x, y, w, h;
    double ox, oy;
    double d, d2;
    double lx, ly;

    ox = canvas->current_region->ox;
    oy = canvas->current_region->oy;

    double px = canvas->px;
    double py = canvas->py;

    ufsmm_get_state_absolute_coords(s, &x, &y, &w, &h);


    x += ox;
    y += oy;

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
