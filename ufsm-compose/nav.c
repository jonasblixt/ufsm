#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ufsm/ufsm.h>
#include "nav.h"
#include "controller.h"
#include "render.h"
#include "utils.h"
#include "logic/canvas.h"

static bool show_nav_tree = false;
static int g_width = 0;
static int g_height = 0;
static double nav_offset = 0;
static double nav_max_y, nav_max_x;
static struct ufsmm_region *g_selected_region;
static struct ufsmm_state *g_selected_state;

void ufsmm_nav_toggle_visibility(struct ufsmm_canvas *canvas)
{
    if (show_nav_tree == false)
        show_nav_tree = true;
    else
        show_nav_tree = false;
    canvas->redraw = true;
}

static double nav_render_region(struct ufsmm_canvas *canvas,
                              struct ufsmm_region *region,
                              double x, double y);

static double nav_render_state(struct ufsmm_canvas *canvas,
                             struct ufsmm_state *state,
                             double x, double y)
{
    struct ufsmm_region *r;
    cairo_t *cr = canvas->cr;
    cairo_text_extents_t extents;
    double y2 = y;
    double x2 = x;
    struct ufsmm_nav_tree_node *node = &state->nav_node;

    //node->expanded = true;
    cairo_text_extents (cr, state->name, &extents);

    if (TAILQ_FIRST(&state->regions)) {
        /* Render node expand box */
        node->expander.x = x - 25;
        node->expander.y = y - extents.height/2 - 7.5;
        node->expander.w = 15;
        node->expander.h = 15;
        cairo_rectangle(cr, node->expander.x, node->expander.y,
                            node->expander.w, node->expander.h);
        cairo_move_to (cr, x - 23, y - extents.height/2);
        cairo_line_to(cr, x - 12, y - extents.height/2);
        if (!node->expanded) {
            cairo_move_to (cr, x - 17.5, y - extents.height/2 + 5);
            cairo_line_to(cr, x - 17.5, y - extents.height/2 - 5);
        }
    }

    /* Render text */
    cairo_move_to (cr, x, y);

    cairo_save(cr);
    if (state == g_selected_state)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_show_text (cr, state->name);
    cairo_restore(cr);

    node->text_block.x = x;
    node->text_block.y = y - extents.height;
    node->text_block.w = extents.width;
    node->text_block.h = extents.height;

    node->x = x;
    node->y = y;

    if (nav_max_y < y)
        nav_max_y = y;

    if (nav_max_x < (x + extents.width))
        nav_max_x = x + extents.width;

    if (node->expanded) {
        TAILQ_FOREACH(r, &state->regions, tailq) {
            y2 += 25;
            y2 = nav_render_region(canvas, r, x2 + 25, y2);
        }
    }
    return y2;
}

static double nav_render_region(struct ufsmm_canvas *canvas,
                              struct ufsmm_region *region,
                              double x, double y)
{
    struct ufsmm_state *s;
    cairo_t *cr = canvas->cr;
    cairo_text_extents_t extents;
    double y2 = y;
    double x2 = x;
    struct ufsmm_nav_tree_node *node = &region->nav_node;
    //node->expanded = true;
    cairo_text_extents (cr, region->name, &extents);

    if (TAILQ_FIRST(&region->states)) {
        /* Render node expand box */
        node->expander.x = x - 25;
        node->expander.y = y - extents.height/2 - 7.5;
        node->expander.w = 15;
        node->expander.h = 15;
        cairo_rectangle(cr, node->expander.x, node->expander.y,
                            node->expander.w, node->expander.h);
        cairo_move_to (cr, x - 23, y - extents.height/2);
        cairo_line_to(cr, x - 12, y - extents.height/2);
        if (!node->expanded) {
            cairo_move_to (cr, x - 17.5, y - extents.height/2 + 5);
            cairo_line_to(cr, x - 17.5, y - extents.height/2 - 5);
        }
    }

    /* Render text */
    cairo_move_to (cr, x, y);
    cairo_save(cr);
    if (region == g_selected_region)
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_ORANGE1);
    else
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    cairo_show_text (cr, region->name);
    cairo_restore(cr);

    node->text_block.x = x;
    node->text_block.y = y - extents.height;
    node->text_block.w = extents.width;
    node->text_block.h = extents.height;

    if (nav_max_y < y)
        nav_max_y = y;

    if (nav_max_x < (x + extents.width))
        nav_max_x = x + extents.width;

    if (node->expanded) {
        TAILQ_FOREACH(s, &region->states, tailq) {
            y2 += 25;
            y2 = nav_render_state(canvas, s, x2 + 25, y2);
        }
    }
    return y2;
}

static bool nav_process_region(struct ufsmm_canvas *canvas,
                               struct ufsmm_region *region, double x, double y);

static bool nav_process_state(struct ufsmm_canvas *canvas,
                              struct ufsmm_state *state, double x, double y)
{
    bool result = false;
    struct ufsmm_region *r;
    struct ufsmm_nav_tree_node *node = &state->nav_node;

    /* First check if we clicked on this nodes expander box */
    if (point_in_box2(x, y, node->expander.x, node->expander.y,
                           node->expander.w, node->expander.h)) {
        node->expanded = !node->expanded;
        canvas->redraw = true;
        result = true;
    } else if (node->expanded) {
        TAILQ_FOREACH(r, &state->regions, tailq) {
            if (nav_process_region(canvas, r, x, y)) {
                result = true;
                break;
            }
        }
    }

    return result;
}

static void find_and_activate_parent(struct ufsmm_canvas *canvas,
                                     struct ufsmm_state *state)
{
    struct ufsmm_region *r = state->parent_region;

    while (r) {
        if (r->off_page) {
            L_DEBUG("Found off-page region %s", r->name);
            break;
        }

        if (r->parent_state) {
            r = r->parent_state->parent_region;
        } else {
            r = NULL;
        }
    }

    if (r) {
        L_DEBUG("Switching to region %s", r->name);
        canvas->current_region->draw_as_root = false;
        canvas->current_region = r;
        canvas->current_region->draw_as_root = true;
        if (canvas->current_region->scale == 0)
            canvas->current_region->scale = 1.0;
        canvas->redraw = true;
    }
}

static bool nav_process_region(struct ufsmm_canvas *canvas,
                               struct ufsmm_region *region, double x, double y)
{
    bool result = false;
    struct ufsmm_state *s;
    struct ufsmm_nav_tree_node *node = &region->nav_node;

    L_DEBUG("%.2f, %.2f, %.2f, %2.f, %.2f, %.2f", x, y,
                node->expander.x, node->expander.y,
                node->expander.w, node->expander.h);

    /* First check if we clicked on this nodes expander box */
    if (point_in_box2(x, y, node->expander.x, node->expander.y,
                           node->expander.w, node->expander.h)) {
        node->expanded = !node->expanded;
        canvas->redraw = true;
        result = true;
    } else if (point_in_box2(x, y,  region->nav_node.text_block.x,
                                    region->nav_node.text_block.y,
                                    region->nav_node.text_block.w,
                                    region->nav_node.text_block.h)) {
        L_DEBUG("Clicked on region %s", region->name);
        g_selected_region = region;
        g_selected_state = NULL;
        canvas->redraw = true;
        if (region->parent_state) {
            if (region->off_page) {
                canvas->current_region->draw_as_root = false;
                canvas->current_region = region;
                canvas->current_region->draw_as_root = true;
                if (canvas->current_region->scale == 0)
                    canvas->current_region->scale = 1.0;
            } else {
                find_and_activate_parent(canvas, region->parent_state);
            }
        } else {
            canvas->current_region->draw_as_root = false;
            canvas->current_region = region;
            canvas->current_region->draw_as_root = true;
            if (canvas->current_region->scale == 0)
                canvas->current_region->scale = 1.0;
            canvas->redraw = true;
        }

        result = true;
    } else if (node->expanded) {
        TAILQ_FOREACH(s, &region->states, tailq) {
            if (point_in_box2(x, y, s->nav_node.text_block.x,
                                    s->nav_node.text_block.y,
                                    s->nav_node.text_block.w,
                                    s->nav_node.text_block.h)) {
                L_DEBUG("Clicked on state %s", s->name);
                find_and_activate_parent(canvas, s);
                g_selected_state = s;
                g_selected_region = NULL;
                canvas->redraw = true;
                result = true;
                break;
            }
            if (nav_process_state(canvas, s, x, y)) {
                result = true;
                break;
            }
        }
    }

    return result;
}

bool ufsmm_nav_process(struct ufsmm_canvas *canvas, double x, double y)
{
    if (!show_nav_tree)
        return false;
    return nav_process_region(canvas, canvas->model->root, x, y);
}

bool ufsmm_nav_scroll(struct ufsmm_canvas *canvas, double change)
{
    if (!show_nav_tree)
        return false;

    if ((canvas->px * (canvas->current_region->scale / 2.0)) > nav_max_x)
        return false;

    if ((nav_max_y < g_height) && (change < 0))
        return true;

    nav_offset += change;

    if (nav_offset > 0)
        nav_offset = 0;

    canvas->redraw = true;
}

void ufsmm_nav_render(struct ufsmm_canvas *canvas, int width, int height)
{
    cairo_t *cr = canvas->cr;

    nav_max_y = 0.0;
    g_width = width;
    g_height = height;

    if (!show_nav_tree)
        return;

    cairo_save (cr);
    cairo_set_font_size (cr, 18);
    cairo_set_line_width (cr, 2.0);
    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
    nav_render_region(canvas, canvas->model->root, 30, 25 + nav_offset);
    cairo_stroke (cr);
    cairo_restore(cr);
}

void ufsmm_nav_reset_selection(struct ufsmm_canvas *canvas)
{
    g_selected_region = NULL;
    g_selected_state = NULL;
}
