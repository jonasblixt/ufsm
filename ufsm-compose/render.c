#include <stdio.h>
#include <math.h>
#include <ufsm/model.h>

#include "render.h"
#include "utils.h"

static double selection_sx;
static double selection_sy;
static double selection_ex;
static double selection_ey;
static bool draw_selection;

static void ufsmm_canvas_render_state_guides(struct ufsmm_canvas *canvas,
                                             struct ufsmm_state *state,
                                             int width, int height)
{
    if (!(state->dg_horizontal || state->dg_vertical || state->dg_same_height ||
          state->dg_same_width || state->dg_same_y || state->dg_same_x))
        return;

    cairo_t *cr = canvas->cr;
    double x = state->x;
    double y = state->y;
    double w = state->w;
    double h = state->h;
    double window_w = width * canvas->current_region->scale * 2;
    double window_h = height * canvas->current_region->scale * 2;
    double ox = canvas->current_region->ox;
    double oy = canvas->current_region->oy;

    cairo_save(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BLUE1);

    if (state->dg_horizontal) {
        /* Draw horizontal level mark */
        cairo_move_to(cr, -ox, y + h/2);
        cairo_line_to(cr, window_w - ox, y + h/2);
    }

    if (state->dg_vertical) {
        /* Draw vertical level mark */
        cairo_move_to(cr, x + w/2, -oy);
        cairo_line_to(cr, x + w/2, window_h - oy);
    }

    /* Draw same size markers */
    if (state->kind == UFSMM_STATE_NORMAL) {
        /* Same y coordinate */
        if (state->dg_same_y) {
            cairo_move_to(cr, -ox, y - 5);
            cairo_line_to(cr, window_w - ox, y - 5);
        }

        /* Same x coordinate */
        if (state->dg_same_x) {
            cairo_move_to(cr, x - 5, -oy);
            cairo_line_to(cr, x - 5, window_h - oy);
        }

        if (state->dg_same_height) {
            /* Height */
            cairo_move_to(cr, x + w + 10, y + 5);
            cairo_line_to(cr, x + w + 10, y + h - 5);
            cairo_stroke(cr);
            /* Top arrow */
            cairo_save(cr);
            cairo_new_sub_path(cr);
            cairo_move_to (cr, x + w + 10, y);
            cairo_line_to(cr, x + w + 10 - 5, y + 15);
            cairo_line_to(cr, x + w + 10 + 5, y + 15);
            cairo_close_path(cr);
            cairo_fill(cr);
            cairo_restore(cr);
            /* Bottom arrow */
            cairo_save(cr);
            cairo_new_sub_path(cr);
            cairo_move_to (cr, x + w + 10, y + h);
            cairo_line_to(cr, x + w + 10 - 5, y + h - 15);
            cairo_line_to(cr, x + w + 10 + 5, y + h - 15);
            cairo_close_path(cr);
            cairo_fill(cr);
            cairo_restore(cr);
        }
        if (state->dg_same_width) {
            /* Width */
            cairo_move_to(cr, x + 5, y + h + 10);
            cairo_line_to(cr, x + w - 5, y + h + 10);
            cairo_stroke(cr);
            /* Left arrow */
            cairo_save(cr);
            cairo_new_sub_path(cr);
            cairo_move_to (cr, x,     y + h + 10);
            cairo_line_to(cr, x + 15, y + h + 10 - 5);
            cairo_line_to(cr, x + 15, y + h + 10 + 5);
            cairo_close_path(cr);
            cairo_fill(cr);
            cairo_restore(cr);
            /* Right arrow */
            cairo_save(cr);
            cairo_new_sub_path(cr);
            cairo_move_to(cr, x + w,      y + h + 10);
            cairo_line_to(cr, x + w - 15, y + h + 10 - 5);
            cairo_line_to(cr, x + w - 15, y + h + 10 + 5);
            cairo_close_path(cr);
            cairo_fill(cr);
            cairo_restore(cr);
        }
    }

    cairo_stroke(cr);
    cairo_restore(cr);

    /* Draw center mark */
    cairo_save(cr);
    cairo_set_line_width (cr, 4);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BLUE1);
    cairo_move_to(cr, x + w/2, y + h/2 - 15);
    cairo_line_to(cr, x + w/2, y + h/2 + 15);
    cairo_move_to(cr, x + w/2 + 15, y + h/2);
    cairo_line_to(cr, x + w/2 - 15, y + h/2);
    cairo_stroke(cr);
    cairo_restore(cr);
}

int ufsmm_canvas_render(struct ufsmm_canvas *canvas, int width, int height)
{
    int rc;
    double x, y, w, h;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    static struct ufsmm_stack *stack;

    cairo_save(canvas->cr);
    cairo_scale(canvas->cr, canvas->current_region->scale / 2.0,
                            canvas->current_region->scale / 2.0);

    cairo_translate(canvas->cr, canvas->current_region->ox,
                                canvas->current_region->oy);

    ufsmm_canvas_render_grid(canvas,
                             ufsmm_paper_size_x(canvas->model->paper_size),
                             ufsmm_paper_size_y(canvas->model->paper_size));

    rc = ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    if (rc != UFSMM_OK)
        return rc;

    /* Pass 1: draw states, regions etc*/
    rc = ufsmm_stack_push(stack, (void *) canvas->current_region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        ufsmm_canvas_render_region(canvas, r, false);

        if (r->off_page && (!r->draw_as_root))
            continue;
        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_canvas_render_state(canvas, s);

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    /* Pass 2: draw transitions */
    rc = ufsmm_stack_push(stack, (void *) canvas->current_region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_canvas_render_transition(canvas, &s->transitions);
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page)
                    continue;

                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }


    if (canvas->preview_state) {
        ufsmm_canvas_render_state(canvas, canvas->preview_state);
        ufsmm_canvas_render_state_guides(canvas, canvas->preview_state,
                                          width, height);
    }

    if (canvas->preview_transition)
        ufsmm_canvas_render_one_transition(canvas, canvas->preview_transition);

    /* Pass 3: Draw selection overlay */

    double dashes[] = {10.0,  /* ink */
                       20.0};  /* skip */

    if (draw_selection) {
        cairo_save(canvas->cr);
        if (((selection_ex - selection_sx) < 0) ||
            ((selection_ey - selection_sy) < 0)) {
            ufsmm_color_set(canvas->cr, canvas->theme, UFSMM_COLOR_BLUE1);
        } else {
            ufsmm_color_set(canvas->cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        }
        cairo_set_dash(canvas->cr, dashes, 2, 0);
        cairo_set_line_width(canvas->cr, 1);
        cairo_rectangle(canvas->cr, selection_sx,
                             selection_sy,
                             selection_ex - selection_sx,
                             selection_ey - selection_sy);
        cairo_stroke(canvas->cr);
        cairo_restore(canvas->cr);
    }

    /* Pass 4: Draw drawing guide lines */

    rc = ufsmm_stack_push(stack, (void *) canvas->current_region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_canvas_render_state_guides(canvas, s, width, height);
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page)
                    continue;

                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    cairo_restore(canvas->cr);
    ufsmm_stack_free(stack);

    return rc;
}

int ufsmm_canvas_render_region(struct ufsmm_canvas *canvas,
                               struct ufsmm_region *region,
                               bool nav_mode)
{
    double x, y, w, h;
    double dashes[] = {10.0,  /* ink */
                       10.0};  /* skip */
    cairo_t *cr = canvas->cr;

    if (region->draw_as_root)
        return UFSMM_OK;

    ufsmm_get_region_absolute_coords(canvas, region, &x, &y, &w, &h);

    if (nav_mode == false) {
        if (region->selected || region->off_page) {
            cairo_save (cr);
            cairo_set_font_size (cr, 18);
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
            cairo_move_to (cr, x + 10, y + 25);
            cairo_show_text (cr, region->name);
            cairo_restore(cr);
        }
    }

    if (region->selected && (nav_mode == false)) {
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        cairo_set_dash (cr, dashes, 2, 0);
        cairo_set_line_width (cr, 2);
        cairo_rectangle (cr, x, y, w, h);
        cairo_stroke (cr);
        cairo_restore (cr);
    } else if (TAILQ_NEXT(region, tailq)) {
        if (!TAILQ_NEXT(region, tailq)->selected) {
            cairo_save(cr);
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
            cairo_set_dash(cr, dashes, 2, 0);
            cairo_set_line_width (cr, 2);
            cairo_move_to(cr, x, y + h);
            cairo_line_to(cr, x+w, y+h);
            cairo_stroke(cr);
            cairo_restore(cr);
        }
    }

    if (nav_mode == false) {
        /* Possibly render region 'off-page' symbol */
        if (region->off_page && !region->draw_as_root) {
            cairo_save(cr);
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
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
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
            cairo_set_line_width (cr, 2.0);
            cairo_stroke(cr);
            cairo_restore(cr);
        }

        /* Render resize boxes */
        if (region->selected) {
            cairo_save(cr);
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
            cairo_rectangle (cr, x + w/2 - 5, y - 5, 10, 10);
            cairo_rectangle (cr, x + w/2 - 5, y + h - 5 , 10, 10);
            cairo_fill(cr);
            cairo_restore(cr);
        }
    }

    return 0;
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

    //ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);
    x = state->x;// + canvas->current_region->ox;
    y = state->y;// + canvas->current_region->oy;
    w = state->w;
    h = state->h;

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->selected)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_fill(cr);
    cairo_restore(cr);

    cairo_save(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_set_line_width(cr, 2);

    if (deep) {
        cairo_move_to(cr, x + w/2 - 5, y + h/2 - 5);
        cairo_line_to(cr, x + w/2 - 5, y + h/2 + 5);

        cairo_move_to(cr, x + w/2 + 1, y + h/2 - 5);
        cairo_line_to(cr, x + w/2 + 1, y + h/2 + 5);

        cairo_move_to(cr, x + w/2 - 5, y + h/2);
        cairo_line_to(cr, x + w/2 + 1, y + h/2);

        cairo_move_to(cr, x + w/2 + 6, y + h/2 - 3);
        cairo_line_to(cr, x + w/2 + 6, y + h/2 + 3);

        cairo_move_to(cr, x + w/2 + 3, y + h/2);
        cairo_line_to(cr, x + w/2 + 9, y + h/2);
    } else {
        cairo_move_to(cr, x + w/2 - 3, y + h/2 - 5);
        cairo_line_to(cr, x + w/2 - 3, y + h/2 + 5);

        cairo_move_to(cr, x + w/2 + 3, y + h/2 - 5);
        cairo_line_to(cr, x + w/2 + 3, y + h/2 + 5);

        cairo_move_to(cr, x + w/2 - 3, y + h/2);
        cairo_line_to(cr, x + w/2 + 3, y + h/2);
    }



    cairo_stroke(cr);
    cairo_restore(cr);
    return 0;
}

static int render_terminate_state(struct ufsmm_canvas *canvas,
                                struct ufsmm_state *state)
{
    double x, y, w, h;
    double lbl_x, lbl_y;
    double radius = 10.0;
    double degrees = M_PI / 180.0;
    bool clip_text = false;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;

    //ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    x = state->x;// + canvas->current_region->ox;
    y = state->y;// + canvas->current_region->oy;
    w = state->w;
    h = state->h;

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->selected)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_fill(cr);
    cairo_restore(cr);

    cairo_save(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_set_line_width(cr, 2);

    cairo_move_to(cr, x, y);
    cairo_line_to(cr, x + w, y + h);

    cairo_move_to(cr, x + w, y);
    cairo_line_to(cr, x, y + h);

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

    //ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    x = state->x;
    y = state->y;
    w = state->w;
    h = state->h;

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->selected)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_fill(cr);
    cairo_restore(cr);
    return 0;
}


static int render_join_state(struct ufsmm_canvas *canvas,
                             struct ufsmm_state *state)
{
    double x, y, w, h;
    double lbl_x, lbl_y;
    double radius = 10.0;
    double degrees = M_PI / 180.0;
    bool clip_text = false;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;

    //ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);

    x = state->x;// + canvas->current_region->ox;
    y = state->y;// + canvas->current_region->oy;
    w = state->w;
    h = state->h;
    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->selected)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);

    if (state->orientation == UFSMM_ORIENTATION_HORIZONTAL) {
        cairo_rectangle (cr, x, y, w, 10);
    } else {
        cairo_rectangle (cr, x, y, 10, h);
    }
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_fill(cr);
    cairo_restore(cr);

    if (state->selected) {
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        if (state->orientation == UFSMM_ORIENTATION_HORIZONTAL) {
            cairo_rectangle (cr, x - 5, (y + h/2) - 5, 10, 10);     /* Left */
            cairo_rectangle (cr, x + w - 5, (y + h/2) - 5, 10, 10);     /* Right */
        } else {
            cairo_rectangle (cr, x + w/2 - 5, y - 5, 10, 10);     /* Left */
            cairo_rectangle (cr, x + w/2 - 5, y + h - 5, 10, 10);     /* Right */
        }
        cairo_fill(cr);
        cairo_restore(cr);

    }

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

   // ufsmm_get_state_absolute_coords(state, &x, &y, &w, &h);
    x = state->x;// + canvas->current_region->ox;
    y = state->y;// + canvas->current_region->oy;
    w = state->w;
    h = state->h;
    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->selected)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_fill(cr);
    cairo_restore(cr);

    cairo_save(cr);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    if (state->selected)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_translate(cr, x+w/2, y+h/2);
    cairo_arc(cr, 0, 0, w/2 - 4, 0, 2 * M_PI);
    cairo_fill(cr);
    cairo_close_path(cr);
    cairo_stroke_preserve(cr);
    cairo_fill_preserve(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
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

    x = state->x;
    y = state->y;
    w = state->w;
    h = state->h;

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
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

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);

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
        if (entry->kind == UFSMM_ACTION_REF_NORMAL) {
            snprintf(action_str_buf, sizeof(action_str_buf),
                        "e/ %s()", entry->act->name);
        } else {
            snprintf(action_str_buf, sizeof(action_str_buf),
                        "e/ ^%s", entry->signal->name);
        }
        cairo_text_extents(cr, action_str_buf, &extents);
        entry->x = x + 10;
        entry->y = y + y_offset - extents.height;
        entry->w = extents.width;
        entry->h = extents.height;

        if (entry->selected)
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        else
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);

        cairo_move_to(cr, x + 10, y + y_offset);
        cairo_show_text(cr, action_str_buf);
        y_offset += 20;
    }

    TAILQ_FOREACH(entry, &state->exits, tailq) {
        if (entry->kind == UFSMM_ACTION_REF_NORMAL) {
            snprintf(action_str_buf, sizeof(action_str_buf),
                        "x/ %s()", entry->act->name);
        } else if (entry->kind == UFSMM_ACTION_REF_SIGNAL) {
            snprintf(action_str_buf, sizeof(action_str_buf),
                        "x/ ^%s", entry->signal->name);
        }
        cairo_text_extents(cr, action_str_buf, &extents);
        entry->x = x + 10;
        entry->y = y + y_offset - extents.height;
        entry->w = extents.width;
        entry->h = extents.height;

        if (entry->selected)
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        else
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
        cairo_move_to(cr, x + 10, y + y_offset);
        cairo_show_text(cr, action_str_buf);
        y_offset += 20;
    }

    if (TAILQ_FIRST(&state->regions)) {
        cairo_move_to (cr, x, y + y_offset);
        cairo_line_to(cr, x + w, y + y_offset);
    }

    cairo_restore(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_set_line_width (cr, 2.0);
    cairo_stroke (cr);
    cairo_restore (cr);

    if (clip_text) {
        cairo_save(cr);
        cairo_rectangle(cr, x+2, y+2, w-4, 28);
        cairo_clip(cr);
        cairo_move_to (cr, lbl_x, lbl_y);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
        cairo_set_font_size (cr, 18);
        cairo_show_text (cr, state->name);
        cairo_restore(cr);
    }

    if (state->selected) {
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
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
        case UFSMM_STATE_FORK:
        case UFSMM_STATE_JOIN:
            rc = render_join_state(canvas, state);
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
        case UFSMM_STATE_TERMINATE:
            rc = render_terminate_state(canvas, state);
        break;
    }
    return 0;
}

static void render_selection_boxes(cairo_t *cr,
                                   struct ufsmm_canvas *canvas,
                                   struct ufsmm_transition *t)
{
    double fbx, fby;
    struct ufsmm_vertice *v;
    double begin_x, begin_y, end_x, end_y;
    const double dashes[] = {10.0,  /* ink */
                             10.0};  /* skip */
    struct ufsmm_region *pr = t->source.state->parent_region;

    transition_calc_begin_end_point(t->source.state,
                                    t->source.side,
                                    t->source.offset,
                                    &fbx, &fby);

    transition_calc_begin_end_point(t->dest.state,
                                    t->dest.side,
                                    t->dest.offset,
                                    &end_x, &end_y);
    cairo_save(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    cairo_rectangle (cr, fbx - 5, fby - 5, 10, 10);
    cairo_fill(cr);

    cairo_move_to (cr, fbx, fby);

    TAILQ_FOREACH(v, &t->vertices, tailq) {
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
    ty = t->text_block_coords.y + 20;
    th = t->text_block_coords.h;
    tw = t->text_block_coords.w;

    cairo_save(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    cairo_set_dash (cr, dashes, 2, 0);
    cairo_set_line_width (cr, 2);
    cairo_rectangle (cr, tx, ty, tw, th);
    cairo_stroke (cr);
    cairo_restore (cr);
    /* Draw resize boxes for the text block */

    cairo_save(cr);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    cairo_rectangle (cr, tx - 5, ty - 5, 10, 10);
    cairo_rectangle (cr, tx + tw - 5, ty - 5, 10, 10);
    cairo_rectangle (cr, tx + tw - 5, ty + th - 5, 10, 10);
    cairo_rectangle (cr, tx - 5, ty + th - 5, 10, 10);
    cairo_fill(cr);
    cairo_restore(cr);
}

static void render_transition_text(cairo_t *cr,
                                    struct ufsmm_canvas *canvas,
                                    struct ufsmm_transition *t)
{
    size_t text_pos = 0;
    char text_buf[1024];
    cairo_text_extents_t extents;
    double tx, ty, tw, th;
    unsigned int line_no = 0;
    const char *text_ptr = NULL;
    struct ufsmm_action_ref *ar;
    struct ufsmm_guard_ref *guard;

    cairo_save(cr);
    cairo_set_font_size (cr, 14);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);

    tx = t->text_block_coords.x;
    ty = t->text_block_coords.y + 20;
    tw = t->text_block_coords.w;
    th = t->text_block_coords.h;

    double x = tx;
    double y = ty + 20;
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

    TAILQ_FOREACH(guard, &t->guards, tailq) {

        switch(guard->kind) {
            case UFSMM_GUARD_TRUE:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[%s(), ", guard->act->name);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[%s()]", guard->act->name);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "%s()]", guard->act->name);
                else
                    sprintf(text_buf, "%s(), ", guard->act->name);
             break;
            case UFSMM_GUARD_FALSE:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[!%s(), ", guard->act->name);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[!%s()]", guard->act->name);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "!%s()]", guard->act->name);
                else
                    sprintf(text_buf, "!%s(), ", guard->act->name);
             break;
             case UFSMM_GUARD_GT:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[%s() > %i, ", guard->act->name, guard->value);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[%s() > %i]", guard->act->name, guard->value);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "%s() > %i]", guard->act->name, guard->value);
                else
                    sprintf(text_buf, "%s() > %i, ", guard->act->name, guard->value);
             break;
             case UFSMM_GUARD_GTE:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[%s() >= %i, ", guard->act->name, guard->value);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[%s() >= %i]", guard->act->name, guard->value);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "%s() >= %i]", guard->act->name, guard->value);
                else
                    sprintf(text_buf, "%s() >= %i, ", guard->act->name, guard->value);
             break;
             case UFSMM_GUARD_EQ:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[%s() == %i, ", guard->act->name, guard->value);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[%s() == %i]", guard->act->name, guard->value);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "%s() == %i]", guard->act->name, guard->value);
                else
                    sprintf(text_buf, "%s() == %i, ", guard->act->name, guard->value);
             break;
             case UFSMM_GUARD_LT:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[%s() < %i, ", guard->act->name, guard->value);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[%s() < %i]", guard->act->name, guard->value);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "%s() < %i]", guard->act->name, guard->value);
                else
                    sprintf(text_buf, "%s() < %i, ", guard->act->name, guard->value);
             break;
             case UFSMM_GUARD_LTE:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[%s() <= %i, ", guard->act->name, guard->value);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[%s() <= %i]", guard->act->name, guard->value);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "%s() <= %i]", guard->act->name, guard->value);
                else
                    sprintf(text_buf, "%s() <= %i, ", guard->act->name, guard->value);
             break;
             case UFSMM_GUARD_PSTATE:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[<%s>, ", guard->state->name);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[<%s>]", guard->state->name);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "<%s>]", guard->state->name);
                else
                    sprintf(text_buf, "<%s>, ", guard->state->name);
             break;
             case UFSMM_GUARD_NSTATE:
                if ((guard == TAILQ_FIRST(&t->guards)) && TAILQ_NEXT(guard, tailq))
                    sprintf(text_buf, "[!<%s>, ", guard->state->name);
                else if ((guard == TAILQ_FIRST(&t->guards)) && (TAILQ_NEXT(guard, tailq) == NULL))
                    sprintf(text_buf, "[!<%s>]", guard->state->name);
                else if (TAILQ_NEXT(guard, tailq) == NULL)
                    sprintf(text_buf, "!<%s>]", guard->state->name);
                else
                    sprintf(text_buf, "!<%s>, ", guard->state->name);
             break;
             default:
                sprintf(text_buf, "????");
             break;
        }

        cairo_text_extents (cr, text_buf, &extents);
        x_space -= (extents.width + 10);

        if (x_space < 10) {
            line_no++;
            x_space = tw;
            x = tx;
        }

        y = ty + 20 + 20 * line_no;

        guard->x = x;
        guard->y = y - extents.height / 2;
        guard->w = extents.width;
        guard->h = extents.height;

        if (!t->selected)
            guard->selected = false;

        cairo_move_to (cr, x, y);
        if (guard->selected)
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        else
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
        cairo_show_text (cr, text_buf);

        x += extents.width + 10;

    }

    TAILQ_FOREACH(ar, &t->actions, tailq) {
        if ((ar == TAILQ_FIRST(&t->actions)) && TAILQ_NEXT(ar, tailq)) {
            if (ar->kind == UFSMM_ACTION_REF_NORMAL)
                sprintf(text_buf, " / %s(), ", ar->act->name);
            else if (ar->kind == UFSMM_ACTION_REF_SIGNAL)
                sprintf(text_buf, " / ^%s, ", ar->signal->name);
        } else if ((ar == TAILQ_FIRST(&t->actions)) && (TAILQ_NEXT(ar, tailq) == NULL)) {
            if (ar->kind == UFSMM_ACTION_REF_NORMAL)
                sprintf(text_buf, " / %s()", ar->act->name);
            else if (ar->kind == UFSMM_ACTION_REF_SIGNAL)
                sprintf(text_buf, " / ^%s", ar->signal->name);
        } else if (TAILQ_NEXT(ar, tailq)) {
            if (ar->kind == UFSMM_ACTION_REF_NORMAL)
                sprintf(text_buf, "%s(), ", ar->act->name);
            else if (ar->kind == UFSMM_ACTION_REF_SIGNAL)
                sprintf(text_buf, "^%s, ", ar->signal->name);
        } else {
            if (ar->kind == UFSMM_ACTION_REF_NORMAL)
                sprintf(text_buf, "%s()", ar->act->name);
            else if (ar->kind == UFSMM_ACTION_REF_SIGNAL)
                sprintf(text_buf, "^%s", ar->signal->name);
        }

        cairo_text_extents (cr, text_buf, &extents);
        x_space -= (extents.width + 10);

        if (x_space < 10) {
            line_no++;
            x_space = tw;
            x = tx;
        }

        y = ty + 20 + 20 * line_no;

        ar->x = x;
        ar->y = y - extents.height / 2;
        ar->w = extents.width;
        ar->h = extents.height;

        if (!t->selected)
            ar->selected = false;

        cairo_move_to (cr, x, y);

        if (ar->selected)
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
        else
            ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
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

    transition_calc_begin_end_point(t->source.state,
                         t->source.side,
                         t->source.offset,
                         &begin_x, &begin_y);

    if (t->dest.state) {
        transition_calc_begin_end_point(
                            t->dest.state,
                             t->dest.side,
                             t->dest.offset,
                             &end_x, &end_y);
    } else {
        end_x = ufsmm_canvas_nearest_grid_point(canvas->px - canvas->current_region->ox);
        end_y = ufsmm_canvas_nearest_grid_point(canvas->py - canvas->current_region->oy);
    }

    cairo_save(cr);
    cairo_move_to (cr, begin_x, begin_y);
    cairo_set_line_width (cr, 2.0);

    double y_off = 0.0;
    struct ufsmm_state *ps = NULL;

    TAILQ_FOREACH(v, &t->vertices, tailq) {
        cairo_line_to(cr, v->x, v->y + - y_off);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
        cairo_stroke (cr);
        cairo_move_to (cr, v->x, v->y + - y_off);
        begin_x = v->x;
        begin_y = v->y - y_off;
    }

    cairo_line_to(cr, end_x, end_y);

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
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

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_new_sub_path(cr);
    cairo_move_to (cr, end_x, end_y);
    cairo_line_to(cr, x1, y1);
    cairo_line_to(cr, x2, y2);
    cairo_close_path(cr);
    cairo_fill(cr);
    cairo_restore(cr);

    render_transition_text(cr, canvas, t);

    if (t->dest.state) {
        /* Draw selection boxes if focused */
        if (t->selected)
            render_selection_boxes(cr, canvas, t);
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

int ufsmm_canvas_render_grid(struct ufsmm_canvas *canvas, int width, int height)
{
    double scale = canvas->current_region->scale;
    cairo_t *cr = canvas->cr;

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_paint(cr);

    cairo_save(cr);

    int step_size = 10;

    if (scale <= 1.0) {
        step_size = 30;
    } else if (scale <= 3.0) {
        step_size = 20;
    }

    int w = (width / step_size) * step_size;
    int h = (height / step_size) * step_size;

    /* Draw grid */
    for (int x = 0; x <= w/step_size; x++)
    {
        cairo_move_to (cr, x*step_size, 0);
        cairo_line_to (cr, x*step_size, h);
    }

    for (int y = 0; y <= h/step_size; y++)
    {
        cairo_move_to (cr, 0, y*step_size);
        cairo_line_to (cr, w, y*step_size);
    }

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG1);
    cairo_set_line_width(cr, 1);
    cairo_stroke (cr);

    cairo_restore(cr);
    return 0;
}

static void hex_to_rgb(uint32_t hex, double *r, double *g, double *b)
{
    (*r) = (double) ((hex >> 24) & 0xff) / 0xff;
    (*g) = (double) ((hex >> 16) & 0xff) / 0xff;
    (*b) = (double) ((hex >> 8) & 0xff) / 0xff;
}


/* ufsm-compose uses the 'gruvbox' color theme.
 *    https://github.com/morhetz/gruvbox
 **/
int ufsmm_color_set(cairo_t *cr, enum ufsmm_color_theme theme,
                                 enum ufsmm_color color)
{
    double r, g, b;

    if (theme == UFSMM_COLOR_THEME_DARK) {
        switch (color) {
        case UFSMM_COLOR_BG:
            hex_to_rgb(0x28282800, &r, &g, &b);
        break;
        case UFSMM_COLOR_RED1:
            hex_to_rgb(0xcc241d00, &r, &g, &b);
        break;
        case UFSMM_COLOR_GREEN1:
            hex_to_rgb(0x98971a00, &r, &g, &b);
        break;
        case UFSMM_COLOR_YELLOW1:
            hex_to_rgb(0xd7992100, &r, &g, &b);
        break;
        case UFSMM_COLOR_BLUE1:
            hex_to_rgb(0x45858800, &r, &g, &b);
        break;
        case UFSMM_COLOR_PURPLE1:
            hex_to_rgb(0xb1628600, &r, &g, &b);
        break;
        case UFSMM_COLOR_AQUA1:
            hex_to_rgb(0x689d6a00, &r, &g, &b);
        break;
        case UFSMM_COLOR_GRAY1:
            hex_to_rgb(0xa8998400, &r, &g, &b);
        break;

        case UFSMM_COLOR_GRAY2:
            hex_to_rgb(0x92837400, &r, &g, &b);
        break;
        case UFSMM_COLOR_RED2:
            hex_to_rgb(0xfb493400, &r, &g, &b);
        break;
        case UFSMM_COLOR_GREEN2:
            hex_to_rgb(0xb8bb2600, &r, &g, &b);
        break;
        case UFSMM_COLOR_YELLOW2:
            hex_to_rgb(0xfabd2f00, &r, &g, &b);
        break;
        case UFSMM_COLOR_BLUE2:
            hex_to_rgb(0x83a59800, &r, &g, &b);
        break;
        case UFSMM_COLOR_PURPLE2:
            hex_to_rgb(0xd3869b00, &r, &g, &b);
        break;
        case UFSMM_COLOR_AQUA2:
            hex_to_rgb(0x8ec07c00, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG:
            hex_to_rgb(0xebdbb200, &r, &g, &b);
        break;


        case UFSMM_COLOR_BG0_H:
            hex_to_rgb(0x1d202100, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG0:
            hex_to_rgb(0x28282800, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG1:
            hex_to_rgb(0x3c383600, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG2:
            hex_to_rgb(0x50494500, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG3:
            hex_to_rgb(0x665c5400, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG4:
            hex_to_rgb(0x7c6f6400, &r, &g, &b);
        break;
        case UFSMM_COLOR_GRAY3:
            hex_to_rgb(0x92837400, &r, &g, &b);
        break;
        case UFSMM_COLOR_ORANGE1:
            hex_to_rgb(0xd65d0e00, &r, &g, &b);
        break;

        case UFSMM_COLOR_BG0_S:
            hex_to_rgb(0x32302f00, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG4:
            hex_to_rgb(0xa8998400, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG3:
            hex_to_rgb(0xbdae9300, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG2:
            hex_to_rgb(0x5dc4a100, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG1:
            hex_to_rgb(0xebdbb200, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG0:
            hex_to_rgb(0xfbf1c700, &r, &g, &b);
        break;
        case UFSMM_COLOR_ORANGE2:
            hex_to_rgb(0xfe801900, &r, &g, &b);
        break;
        default:
            hex_to_rgb(0x00000000, &r, &g, &b);
        }
    } else {
        switch (color) {
        case UFSMM_COLOR_BG:
            hex_to_rgb(0xfbf1c700, &r, &g, &b);
        break;
        case UFSMM_COLOR_RED1:
            hex_to_rgb(0xcc241d00, &r, &g, &b);
        break;
        case UFSMM_COLOR_GREEN1:
            hex_to_rgb(0x98971a00, &r, &g, &b);
        break;
        case UFSMM_COLOR_YELLOW1:
            hex_to_rgb(0xd7992100, &r, &g, &b);
        break;
        case UFSMM_COLOR_BLUE1:
            hex_to_rgb(0x45858800, &r, &g, &b);
        break;
        case UFSMM_COLOR_PURPLE1:
            hex_to_rgb(0xb1628600, &r, &g, &b);
        break;
        case UFSMM_COLOR_AQUA1:
            hex_to_rgb(0x689d6a00, &r, &g, &b);
        break;
        case UFSMM_COLOR_GRAY1:
            hex_to_rgb(0x7c6f6400, &r, &g, &b);
        break;

        case UFSMM_COLOR_GRAY2:
            hex_to_rgb(0x92837400, &r, &g, &b);
        break;
        case UFSMM_COLOR_RED2:
            hex_to_rgb(0x9d000600, &r, &g, &b);
        break;
        case UFSMM_COLOR_GREEN2:
            hex_to_rgb(0x79740e00, &r, &g, &b);
        break;
        case UFSMM_COLOR_YELLOW2:
            hex_to_rgb(0xb5761400, &r, &g, &b);
        break;
        case UFSMM_COLOR_BLUE2:
            hex_to_rgb(0x07667800, &r, &g, &b);
        break;
        case UFSMM_COLOR_PURPLE2:
            hex_to_rgb(0x8f3f7100, &r, &g, &b);
        break;
        case UFSMM_COLOR_AQUA2:
            hex_to_rgb(0x427b5800, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG:
            hex_to_rgb(0x3c383600, &r, &g, &b);
        break;


        case UFSMM_COLOR_BG0_H:
            hex_to_rgb(0xf9f5d700, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG0:
            hex_to_rgb(0xfbf1c700, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG1:
            hex_to_rgb(0xebdbb200, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG2:
            hex_to_rgb(0xd4c4a100, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG3:
            hex_to_rgb(0xbdae9300, &r, &g, &b);
        break;
        case UFSMM_COLOR_BG4:
            hex_to_rgb(0xa8998400, &r, &g, &b);
        break;
        case UFSMM_COLOR_GRAY3:
            hex_to_rgb(0x92837400, &r, &g, &b);
        break;
        case UFSMM_COLOR_ORANGE1:
            hex_to_rgb(0xd65d0e00, &r, &g, &b);
        break;

        case UFSMM_COLOR_BG0_S:
            hex_to_rgb(0xf2e5bc00, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG4:
            hex_to_rgb(0x7c6f6400, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG3:
            hex_to_rgb(0x665c5400, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG2:
            hex_to_rgb(0x50494500, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG1:
            hex_to_rgb(0x3c383600, &r, &g, &b);
        break;
        case UFSMM_COLOR_FG0:
            hex_to_rgb(0x28282800, &r, &g, &b);
        break;
        case UFSMM_COLOR_ORANGE2:
            hex_to_rgb(0xaf3a0300, &r, &g, &b);
        break;
        default:
            hex_to_rgb(0x00000000, &r, &g, &b);
        }
    }

    cairo_set_source_rgb (cr, r, g, b);
}
