#include <stdio.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include <gtk/gtk.h>
#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

#include "gui/edit_state_dialog.h"
#include "gui/add_action_dialog.h"
#include "gui/edit_string_dialog.h"
#include "gui/set_trigger_dialog.h"

/* Entry action function prototypes */
void canvas_update_selection(void *context)
{
}

void canvas_show_tool_help(void *context)
{
}

void canvas_save(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s: writing to '%s'", __func__, priv->model->filename);
    ufsmm_model_write(priv->model->filename, priv->model);
}

void canvas_check_sresize_boxes(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    double x, y, w, h;
    double px = priv->px;
    double py = priv->py;

    if (s->kind != UFSMM_STATE_NORMAL)
        return;

    ufsmm_get_state_absolute_coords(priv->selected_state, &x, &y, &w, &h);

    x += r->ox;
    y += r->oy;

    /* Check re-size boxes */
    if (point_in_box(px, py, x, y, 10, 10)) {
        L_DEBUG("Top left corner!");
        priv->selected_corner = UFSMM_TOP_LEFT;
    } else if (point_in_box(px, py, x + w, y, 10, 10)) {
        L_DEBUG("Top right corner!");
        priv->selected_corner = UFSMM_TOP_RIGHT;
    } else if (point_in_box(px, py, x + w/2, y, 10, 10)) {
        L_DEBUG("Top middle");
        priv->selected_corner = UFSMM_TOP_MIDDLE;
    } else if (point_in_box(px, py, x, y + h/2, 10, 10)) {
        L_DEBUG("Left middle");
        priv->selected_corner = UFSMM_LEFT_MIDDLE;
    } else if (point_in_box(px, py, x, y + h, 10, 10)) {
        L_DEBUG("Bottom left corner");
        priv->selected_corner = UFSMM_BOT_LEFT;
    } else if (point_in_box(px, py, x + w/2, y + h, 10, 10)) {
        L_DEBUG("Bottom middle");
        priv->selected_corner = UFSMM_BOT_MIDDLE;
    } else if (point_in_box(px, py, x + w, y + h, 10, 10)) {
        L_DEBUG("Bottom right corner");
        priv->selected_corner = UFSMM_BOT_RIGHT;
    } else if (point_in_box(px, py, x + w, y + h/2, 10, 10)) {
        L_DEBUG("Right middle");
        priv->selected_corner = UFSMM_RIGHT_MIDDLE;
    } else {
        priv->selected_corner = UFSMM_NO_SELECTION;
    }
}

void canvas_check_rresize_boxes(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->selected_region;
    double x, y, w, h;
    double px = priv->px;
    double py = priv->py;

    ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);

    x += priv->current_region->ox;
    y += priv->current_region->oy;

    L_DEBUG("x=%.2f, y=%.2f, px=%.2f, py=%.2f",x+w/2, y, px, py);
    /* Check re-size boxes */
    if (point_in_box(px, py, x + w/2, y, 10, 10)) {
        L_DEBUG("Top middle");
        priv->selected_corner = UFSMM_TOP_MIDDLE;
    } else if (point_in_box(px, py, x + w/2, y + h, 10, 10)) {
        L_DEBUG("Bottom middle");
        priv->selected_corner = UFSMM_BOT_MIDDLE;
    } else {
        priv->selected_corner = UFSMM_NO_SELECTION;
    }
}

void canvas_check_action_func(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;

    if (priv->selected_aref != NULL) {
        priv->selected_aref->focus = false;
        priv->selected_aref = NULL;
    }

    if (priv->selection == UFSMM_SELECTION_STATE) {
        /* Check action functions */
        for (struct ufsmm_action_ref *ar = s->entries; ar; ar = ar->next) {
            if (point_in_box2(priv->px, priv->py, ar->x + r->ox, ar->y + r->oy, ar->w, ar->h)) {
                L_DEBUG("%s selected", ar->act->name);
                priv->selected_aref = ar;
                priv->selection = UFSMM_SELECTION_ENTRY;
                ar->focus = true;
            } else {
                ar->focus = false;
            }
        }

        for (struct ufsmm_action_ref *ar = s->exits; ar; ar = ar->next) {
            if (point_in_box2(priv->px, priv->py, ar->x + r->ox, ar->y + r->oy, ar->w, ar->h)) {
                L_DEBUG("%s selected", ar->act->name);
                priv->selected_aref = ar;
                priv->selection = UFSMM_SELECTION_EXIT;
                ar->focus = true;
            } else {
                ar->focus = false;
            }
        }
    }
}

void canvas_reset_focus(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
}

void canvas_focus_state(void *context)
{
}

void canvas_focus_region(void *context)
{
}

void canvas_begin_mselect(void *context)
{
}

void canvas_focus_transition(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    L_DEBUG("Transition %s --> %s selected",
                t->source.state->name, t->dest.state->name);
    t->focus = true;
    priv->redraw = true;
}

void canvas_move_vertice(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *cr = priv->current_region;

    double dx = priv->dx;// / priv->current_region->scale;
    double dy = priv->dy;// / priv->current_region->scale;
    double tx = priv->tx;// / priv->current_region->scale;
    priv->redraw = true;

    switch (priv->selected_transition_vertice) {
        case UFSMM_TRANSITION_VERTICE_START:
        {
            enum ufsmm_side src_side;
            double src_offset;
            struct ufsmm_state *new_src_state = NULL;

            if (ufsmm_state_get_at_xy(priv, priv->current_region,
                                        priv->px,
                                        priv->py,
                                        &new_src_state, NULL) == UFSMM_OK) {
                if (new_src_state != t->source.state) {
                    L_DEBUG("Switching to new source: %s",
                                    new_src_state->name);
                    //t->source.state = new_src_state;
                    ufsmm_transition_change_src_state(t, new_src_state);
                }
            }

            ufsmm_state_get_closest_side(priv,
                                         t->source.state,
                                         &src_side,
                                         &src_offset);

            if (t->source.side != src_side) {
                t->source.side = src_side;
                t->source.offset = src_offset;
                /* Reset offset and delta when switching sides */
                priv->tx = src_offset;
                priv->sx = priv->px;
                priv->sy = priv->py;
                dx = priv->dx;
                dy = priv->dy;
                tx = priv->tx;
            }

            if (t->source.side == UFSMM_SIDE_LEFT ||
                t->source.side == UFSMM_SIDE_RIGHT) {
                t->source.offset = ufsmm_canvas_nearest_grid_point(tx + dy);
            } else {
                t->source.offset = ufsmm_canvas_nearest_grid_point(tx + dx);
            }
        }
        break;
        case UFSMM_TRANSITION_VERTICE:
            priv->selected_transition_vertice_data->y = (priv->ty + dy);
            priv->selected_transition_vertice_data->x = (priv->tx + dx);

            priv->selected_transition_vertice_data->y =
                ufsmm_canvas_nearest_grid_point(priv->selected_transition_vertice_data->y);

            priv->selected_transition_vertice_data->x =
                ufsmm_canvas_nearest_grid_point(priv->selected_transition_vertice_data->x);
        break;
        case UFSMM_TRANSITION_VERTICE_END:
        {
            enum ufsmm_side dest_side;
            struct ufsmm_state *new_dest_state = NULL;
            double dest_offset;

            if (ufsmm_state_get_at_xy(priv, priv->current_region,
                                        priv->px,
                                        priv->py,
                                        &new_dest_state, NULL) == UFSMM_OK) {
                if (new_dest_state != t->dest.state) {
                    L_DEBUG("Switching to new destination: %s",
                                    new_dest_state->name);
                    t->dest.state = new_dest_state;
                }
            }

            ufsmm_state_get_closest_side(priv,
                                         t->dest.state,
                                         &dest_side,
                                         &dest_offset);

            if (t->dest.side != dest_side) {
                L_DEBUG("Changing side from %i to %i",
                    t->dest.side, dest_side);
                t->dest.side = dest_side;
                t->dest.offset = dest_offset;

                /* Reset offset and delta when switching sides */
                priv->tx = dest_offset;
                priv->sx = priv->px;
                priv->sy = priv->py;
                dx = priv->dx;
                dy = priv->dy;
                tx = priv->tx;
            }

            if (t->dest.side == UFSMM_SIDE_LEFT ||
                        t->dest.side == UFSMM_SIDE_RIGHT) {
                t->dest.offset = ufsmm_canvas_nearest_grid_point(tx + dy);
            } else {
                t->dest.offset = ufsmm_canvas_nearest_grid_point(tx + dx);
            }
        }
        break;
        case UFSMM_TRANSITION_VERTICE_NONE:
        break;
        default:
            return;
    }
}

void canvas_check_guard(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *cr = priv->current_region;

    for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next)
        ar->focus = false;

    for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next) {
        if (point_in_box2(priv->px, priv->py, ar->x + cr->ox,
                                              ar->y + cr->oy, ar->w, ar->h)) {
            ar->focus = true;
            priv->redraw = true;
            priv->selected_aref = ar;
            priv->selection = UFSMM_SELECTION_GUARD;
            L_DEBUG("Selected guard!");
        }
    }
}

void canvas_check_action(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *cr = priv->current_region;

    for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next)
        ar->focus = false;

    for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next) {
        if (point_in_box2(priv->px, priv->py, ar->x + cr->ox,
                                              ar->y + cr->oy, ar->w, ar->h)) {
            ar->focus = true;
            priv->redraw = true;
            priv->selected_aref = ar;
            priv->selection = UFSMM_SELECTION_ACTION;
            L_DEBUG("Selected action!");
        }
    }
}

void canvas_focus_guard(void *context)
{
}

void canvas_focus_action(void *context)
{
}

void canvas_focus_entry(void *context)
{
}

void canvas_focus_exit(void *context)
{
}

void canvas_check_text_block(void *context)
{
}

/* Exit action function prototypes */
void canvas_hide_tool_help(void *context)
{
}

void canvas_end_mselect(void *context)
{
}

void canvas_hide_state_hint(void *context)
{
}

void canvas_show_state_hint(void *context)
{
}

void canvas_hide_transition_hint(void *context)
{
}

void canvas_cleanup_transition(void *context)
{
}

bool canvas_guard_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_GUARD);
}

bool canvas_action_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_ACTION);
}

bool canvas_state_exit_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_EXIT);
}

bool canvas_textblock_resize_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selected_corner != UFSMM_NO_SELECTION);
}

bool canvas_only_state_selected(void *context)
{
    return false;
}


/* Action function prototypes */
void canvas_select_root_region(void *context)
{
}



void canvas_zoom_in(void *context)
{
}

void canvas_zoom_out(void *context)
{
}

void canvas_move_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    double x, y, w, h;

    L_DEBUG("%s: ", __func__);

    //priv->sx = priv->px - s->x;
    //priv->sy = priv->py - s->y;
    ufsmm_get_state_absolute_coords(s, &x, &y, &w, &h);

    /* Store current position and size */
    priv->tx = s->x;
    priv->ty = s->y;
    priv->tw = s->w;
    priv->th = s->h;

    /* Calculate the pointer offset inside the state */
    priv->t[0] = priv->px - x - r->ox;
    priv->t[1] = priv->py - y - r->oy;

    printf("State MOVE BEGIN %.2f, %.2f\n", priv->sx, priv->sy);
}

void canvas_move_state_end(void *context)
{
    L_DEBUG("%s: ", __func__);
}

void canvas_move_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *new_pr;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    double x, y, w, h;
    double tx_tmp, ty_tmp;
    double ox, oy;
    int rc;
    printf("%s: %s --> %f %f\n", __func__, s->name, priv->px, priv->py);

    s->x = ufsmm_canvas_nearest_grid_point(priv->tx + priv->dx);
    s->y = ufsmm_canvas_nearest_grid_point(priv->ty + priv->dy);

    /* Move transition vertices on transitions originating from this state */
    /*for (struct ufsmm_transition *t = s->transition; t; t = t->next) {
        if ((t->source.state == s) &&
            (t->dest.state == s)) {

            t->text_block_coords.x += priv->dx;
            t->text_block_coords.y += priv->dy;

            for (struct ufsmm_vertice *v = t->vertices; v; v = v->next) {
                v->x += priv->dx;
                v->y += priv->dy;
            }
        }
    }*/

    /* Check if state is dragged on top of another region, if so, re-parent state */
    rc = ufsmm_region_get_at_xy(priv, priv->current_region,
                                    priv->px, priv->py, &new_pr, NULL);

    if (rc == UFSMM_OK && (s->parent_region != new_pr)) {
        L_DEBUG("Re-parent '%s' to region: %s", s->name, new_pr->name);


        ufsmm_get_region_absolute_coords(s->parent_region, &x, &y, &w, &h);
        double diff_x = x;
        double diff_y = y;
        ufsmm_get_region_absolute_coords(new_pr, &x, &y, &w, &h);
        diff_x -= x;
        diff_y -= y;

        if (ufsmm_state_move_to_region(priv->model, s, new_pr) == UFSMM_OK) {
            ufsmm_get_region_absolute_coords(new_pr, &x, &y, &w, &h);

            priv->tx = priv->px - x - r->ox - priv->t[0];
            priv->ty = priv->py - y - r->oy - priv->t[1];

            s->x = ufsmm_canvas_nearest_grid_point(priv->tx + priv->dx);
            s->y = ufsmm_canvas_nearest_grid_point(priv->ty + priv->dy);

            priv->sx = priv->px;
            priv->sy = priv->py;

            /* Update vertice coordinates on outgoing transitions */
            for (struct ufsmm_transition *t = s->transition; t; t = t->next) {
                t->text_block_coords.x += diff_x;
                t->text_block_coords.y += diff_y;

                for (struct ufsmm_vertice *v = t->vertices; v; v = v->next) {
                    v->x += diff_x;
                    v->y += diff_y;
                }
            }
        }
    }

    priv->redraw = true;
}

void canvas_resize_region_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->selected_region;
    priv->th = r->h;
}

void canvas_resize_region(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->selected_region;
    priv->redraw = true;

    double dy = priv->dy;
    double dx = priv->dx;

    switch (priv->selected_corner) {
        case UFSMM_TOP_MIDDLE:
            r->h = priv->th - dy;
        break;
        case UFSMM_BOT_MIDDLE:
            r->h = priv->th + dy;
        break;
        default:
        break;
    }

    r->h = ufsmm_canvas_nearest_grid_point(r->h);
}

void canvas_resize_region_end(void *context)
{
}

void canvas_reorder_entry_func(void *context)
{
}

void canvas_update_mselect(void *context)
{
}

void canvas_move_text_block(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    t->text_block_coords.x = ufsmm_canvas_nearest_grid_point(priv->tx + priv->dx);
    t->text_block_coords.y = ufsmm_canvas_nearest_grid_point(priv->ty + priv->dy);

    priv->redraw = true;
}

void canvas_reorder_exit_func(void *context)
{
}

void canvas_reorder_guard_func(void *context)
{
}

void canvas_reorder_action_func(void *context)
{
}

void canvas_resize_textblock(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    double dy = priv->dy;
    double dx = priv->dx;

    switch (priv->selected_corner) {
        case UFSMM_TOP_RIGHT:
        {
            if (t->text_block_coords.w <= 50) {
                t->text_block_coords.w = 50;
            } else {
                t->text_block_coords.w = priv->tw + dx;
            }

            if ((priv->th - dy) <= 30) {
                t->text_block_coords.h = 30;
            } else {
                t->text_block_coords.h = priv->th - dy;
                t->text_block_coords.y = priv->ty + dy;
            }
        }
        break;
        case UFSMM_BOT_RIGHT:
            t->text_block_coords.w = priv->tw + dx;
            t->text_block_coords.h = priv->th + dy;
        break;
        case UFSMM_BOT_LEFT:
            t->text_block_coords.w = priv->tw - dx;
            t->text_block_coords.x = priv->tx + dx;
            t->text_block_coords.h = priv->th + dy;
        break;
        case UFSMM_TOP_LEFT:
            if (t->text_block_coords.w <= 50) {
                t->text_block_coords.w = 50;
            } else {
                t->text_block_coords.w = priv->tw - dx;
                t->text_block_coords.x = priv->tx + dx;
            }

            if ((priv->th - dy) <= 30) {
                t->text_block_coords.h = 30;
            } else {
                t->text_block_coords.h = priv->th - dy;
                t->text_block_coords.y = priv->ty + dy;
            }
        break;
        default:
            return;
    }

    priv->redraw = true;

    if (t->text_block_coords.w < 50)
        t->text_block_coords.w = 50;

    if (t->text_block_coords.h < 30)
        t->text_block_coords.h = 30;

    t->text_block_coords.x = ufsmm_canvas_nearest_grid_point(t->text_block_coords.x);
    t->text_block_coords.y = ufsmm_canvas_nearest_grid_point(t->text_block_coords.y);
    t->text_block_coords.w = ufsmm_canvas_nearest_grid_point(t->text_block_coords.w);
    t->text_block_coords.h = ufsmm_canvas_nearest_grid_point(t->text_block_coords.h);
}

void canvas_add_region(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *new_region = NULL;
    int rc;
    rc = ufsmm_add_region(priv->selected_state, false, &new_region);
    new_region->name = strdup("New region");
    new_region->h = 40;
    priv->redraw = true;
    L_DEBUG("Created new region");
}

void canvas_add_entry(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    rc = ufsm_add_entry_action_dialog(GTK_WINDOW(priv->root_window),
                                        priv->model,
                                        priv->selected_state);
    L_DEBUG("Add entry on state %s %i", priv->selected_state->name, rc);
    priv->redraw = true;
}

void canvas_add_exit(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    rc = ufsm_add_exit_action_dialog(GTK_WINDOW(priv->root_window),
                                        priv->model,
                                        priv->selected_state);
    L_DEBUG("Add exit on state %s %i", priv->selected_state->name, rc);
    priv->redraw = true;
}

void canvas_edit_state_name(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsm_edit_string_dialog(GTK_WINDOW(priv->root_window), "Edit state name",
                                &priv->selected_state->name);
}

void canvas_edit_region_name(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsm_edit_string_dialog(GTK_WINDOW(priv->root_window), "Edit region name",
                                &priv->selected_region->name);
}

void canvas_add_guard(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsm_add_transition_guard_dialog(GTK_WINDOW(priv->root_window),
                                            priv->model,
                                            priv->selected_transition);
}

void canvas_edit_state_entry(void *context)
{
}

void canvas_edit_state_exit(void *context)
{
}

void canvas_translate_state(void *context)
{
}

void canvas_delete_region(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    if ((!priv->selected_region->draw_as_root)) {
        struct ufsmm_region *pr = NULL;
        if (priv->selected_region->parent_state) {
            pr = priv->selected_region->parent_state->parent_region;
        } else {
            pr = priv->model->root;
        }

        ufsmm_model_delete_region(priv->model, priv->selected_region);
        priv->selected_region = pr;
        priv->redraw = true;
    }
}

void canvas_delete_guard(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsmm_transition_delete_guard(priv->selected_transition,
                                  priv->selected_aref->act->id);
    priv->redraw = true;
}

void canvas_delete_action(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsmm_transition_delete_action(priv->selected_transition,
                                   priv->selected_aref->act->id);
    priv->redraw = true;
}

void canvas_delete_transition(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    ufsmm_state_delete_transition(t);
    priv->redraw = true;
}

void canvas_delete_entry(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_action_ref *ar = priv->selected_aref;
    L_DEBUG("Deleting entry");

    ufsmm_state_delete_entry(s, ar->act->id);
    priv->redraw = true;
}

void canvas_delete_exit(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_action_ref *ar = priv->selected_aref;

    L_DEBUG("Deleting exit");

    ufsmm_state_delete_exit(s, ar->act->id);
    priv->redraw = true;
}

void canvas_delete_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsmm_model_delete_state(priv->model, priv->selected_state);
    priv->selected_state = NULL;
    priv->selection = UFSMM_SELECTION_NONE;
    priv->redraw = true;
}

void canvas_new_state_set_scoords(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->selected_region;
    struct ufsmm_state *new_state = NULL;
    rc = ufsmm_add_state(priv->selected_region, "New state", &new_state);

    priv->new_state = new_state;


    new_state->x = priv->px;
    new_state->y = priv->py;
    L_DEBUG("New state: sx=%.2f, sy=%.2f", new_state->x, new_state->y);
}

void canvas_create_new_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->new_state;
    struct ufsmm_region *r = priv->selected_region;
    double x, y, w, h;
    double tx = s->x;
    double ty = s->y;
    double ox = priv->current_region->ox;
    double oy = priv->current_region->oy;
    ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);
    s->x = tx - (x + ox);
    double y_offset = 0.0;

    if (r->parent_state)
        y_offset = r->parent_state->region_y_offset;
    s->y = ty - (y + oy) + y_offset;
    s->w = priv->px - tx;
    s->h = priv->py - ty;
    priv->redraw = true;
}

void canvas_update_state_hint(void *context)
{
}

void canvas_create_transition_start(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_state *source_state;

    L_DEBUG("Looking for source state at <%f, %f>", priv->px,
                                                    priv->py);
    rc = ufsmm_state_get_at_xy(priv, priv->current_region,
                                    priv->px,
                                    priv->py,
                                    &source_state, NULL);

    if (rc == UFSMM_OK) {
        L_DEBUG("Found source state: %s", source_state->name);
        priv->new_transition_source_state = source_state;
        ufsmm_state_get_closest_side(priv, source_state,
                                    &priv->new_transition_source_side,
                                    &priv->new_transition_source_offset);
    }
}

void canvas_update_transition_hint(void *context)
{
}

void canvas_create_transition(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_state *dest_state;
    double dest_offset;
    enum ufsmm_side source_side, dest_side;

    L_DEBUG("Looking for dest state at <%f, %f>", priv->px,
                                                  priv->py);
    rc = ufsmm_state_get_at_xy(priv, priv->current_region,
                                    priv->px,
                                    priv->py,
                                    &dest_state, NULL);

    if (rc == UFSMM_OK) {
        L_DEBUG("Found destination state: %s", dest_state->name);

        ufsmm_state_get_closest_side(priv, dest_state, &dest_side,
                                    &dest_offset);
        L_DEBUG("Creating transition %s --> %s", priv->new_transition_source_state->name,
                                                 dest_state->name);
        struct ufsmm_transition *new_transition;
        ufsmm_state_add_transition(priv->new_transition_source_state,
                                   dest_state, &new_transition);
        new_transition->source.side = priv->new_transition_source_side;
        new_transition->source.offset = priv->new_transition_source_offset;
        new_transition->dest.side = dest_side;
        new_transition->dest.offset = dest_offset;
        new_transition->text_block_coords.x = priv->new_transition_source_state->x;
        new_transition->text_block_coords.y = priv->new_transition_source_state->y;
        new_transition->text_block_coords.w = 100;
        new_transition->text_block_coords.h = 30;
        new_transition->vertices = priv->new_transition_vertice;
    }

    priv->new_transition_vertice = NULL;
    priv->redraw = true;
}

void canvas_toggle_region_offpage(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->selected_region->off_page = !priv->selected_region->off_page;
    priv->redraw = true;
}

void canvas_transition_vdel_last(void *context)
{
}

void canvas_add_transition_vertice(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    double x, y, w, h;

    if (priv->new_transition_vertice == NULL) {
        priv->new_transition_vertice = malloc(sizeof(*priv->new_transition_vertice));
        memset(priv->new_transition_vertice, 0, sizeof(*priv->new_transition_vertice));
        priv->new_transition_vertice_last = priv->new_transition_vertice;
    } else {
        priv->new_transition_vertice_last->next = malloc(sizeof(*priv->new_transition_vertice));
        priv->new_transition_vertice_last = priv->new_transition_vertice_last->next;
        memset(priv->new_transition_vertice_last, 0, sizeof(*priv->new_transition_vertice_last));
    }

    ufsmm_get_region_absolute_coords(priv->selected_region, &x, &y, &w, &h);
    priv->new_transition_vertice_last->x =
        ufsmm_canvas_nearest_grid_point(priv->px) - (x + priv->current_region->ox);
    priv->new_transition_vertice_last->y =
        ufsmm_canvas_nearest_grid_point(priv->py) - (y + priv->current_region->oy);

    L_DEBUG("Add vertice at <%f, %f>", priv->new_transition_vertice_last->x,
                                       priv->new_transition_vertice_last->y);
}

void canvas_create_init_state(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    double x, y, w, h;
    double new_state_sx = ufsmm_canvas_nearest_grid_point(priv->px);
    double new_state_sy = ufsmm_canvas_nearest_grid_point(priv->py);
    struct ufsmm_state *new_state = NULL;
    rc = ufsmm_add_state(priv->selected_region, "Init", &new_state);

    if (rc == UFSMM_OK) {
        ufsmm_get_region_absolute_coords(priv->selected_region, &x, &y, &w, &h);
        L_DEBUG("x, y = <%.2f, %.2f>, new_state_xy = <%.2f, %.2f>",
                    x, y, new_state_sx, new_state_sy);
        new_state->x = new_state_sx - (x + priv->current_region->ox);
        new_state->y = new_state_sy - (y + priv->current_region->oy);
        new_state->w = 20;
        new_state->h = 20;
        new_state->kind = UFSMM_STATE_INIT;
        priv->redraw = true;
        L_DEBUG("Created new state, pr = %s", priv->selected_region->name);
    } else {
        L_ERR("Could not create new state");
    }

}

void canvas_create_final_state(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    double x, y, w, h;
    L_DEBUG("Adding final state");
    double new_state_sx = ufsmm_canvas_nearest_grid_point(priv->px);
    double new_state_sy = ufsmm_canvas_nearest_grid_point(priv->py);
    struct ufsmm_state *new_state = NULL;
    rc = ufsmm_add_state(priv->selected_region, "Final", &new_state);

    if (rc == UFSMM_OK) {
        ufsmm_get_region_absolute_coords(priv->selected_region, &x, &y, &w, &h);
        L_DEBUG("x, y = <%.2f, %.2f>, new_state_xy = <%.2f, %.2f>",
                    x, y, new_state_sx, new_state_sy);
        new_state->x = new_state_sx - (x + priv->current_region->ox);
        new_state->y = new_state_sy - (y + priv->current_region->oy);
        new_state->w = 20;
        new_state->h = 20;
        new_state->kind = UFSMM_STATE_FINAL;
        priv->redraw = true;
        L_DEBUG("Created new state, pr = %s", priv->selected_region->name);
    } else {
        L_ERR("Could not create new state");
    }
}

void canvas_save_model(void *context)
{
}

void canvas_set_transition_trigger(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsm_set_trigger_dialog(GTK_WINDOW(priv->root_window), priv->model,
                                        priv->selected_transition);
}

void canvas_add_transition_action(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    ufsm_add_transition_action_dialog(GTK_WINDOW(priv->root_window),
                                            priv->model,
                                            priv->selected_transition);
}

gboolean keypress_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->keyval == GDK_KEY_A) {
        if (priv->current_region->parent_state) {
            L_DEBUG("Ascending to region: %s",
                    priv->current_region->parent_state->parent_region->name);
            priv->current_region->draw_as_root = false;
            do {
                if (!priv->current_region->parent_state)
                    break;
                priv->current_region = priv->current_region->parent_state->parent_region;
            } while (!priv->current_region->off_page);
            priv->current_region->draw_as_root = true;
        }
        priv->redraw = true;
    } else if (event->keyval == GDK_KEY_Shift_L) {
        canvas_machine_process(&priv->machine, eKey_shift_down);
    } else if (event->keyval == GDK_KEY_Control_L) {
        canvas_machine_process(&priv->machine, eEnableScale);
    } else if (event->keyval == GDK_KEY_a) {
        canvas_machine_process(&priv->machine, eKey_a_down);
    } else if (event->keyval == GDK_KEY_n) {
        canvas_machine_process(&priv->machine, eKey_n_down);
    } else if (event->keyval == GDK_KEY_O) {
        canvas_machine_process(&priv->machine, eKey_O_down);
    } else if (event->keyval == GDK_KEY_r) {
        canvas_machine_process(&priv->machine, eKey_r_down);
    } else if (event->keyval == GDK_KEY_t) {
        canvas_machine_process(&priv->machine, eKey_t_down);
    } else if (event->keyval == GDK_KEY_i) {
        canvas_machine_process(&priv->machine, eKey_i_down);
    } else if (event->keyval == GDK_KEY_f) {
        canvas_machine_process(&priv->machine, eKey_f_down);
    } else if (event->keyval == GDK_KEY_g) {
        canvas_machine_process(&priv->machine, eKey_g_down);
    } else if (event->keyval == GDK_KEY_e) {
        canvas_machine_process(&priv->machine, eKey_e_down);
    } else if (event->keyval == GDK_KEY_x) {
        canvas_machine_process(&priv->machine, eKey_x_down);
    } else if (event->keyval == GDK_KEY_Delete) {
        canvas_machine_process(&priv->machine, eKey_delete_down);
    } else if (event->keyval == GDK_KEY_s) {
        canvas_machine_process(&priv->machine, eKey_s_down);
    }
    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

gboolean keyrelease_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->keyval == GDK_KEY_Shift_L) {
        canvas_machine_process(&priv->machine, eKey_shift_up);
    } else if (event->keyval == GDK_KEY_Control_L) {
        canvas_machine_process(&priv->machine, eDisableScale);
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

static gboolean buttonpress_cb(GtkWidget *widget, GdkEventButton *event)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    priv->sx = ufsmm_canvas_nearest_grid_point(event->x / priv->current_region->scale);
    priv->sy = ufsmm_canvas_nearest_grid_point(event->y / priv->current_region->scale);

    if (event->type == GDK_BUTTON_PRESS && event->button == 3) {
        ufsm_process(&priv->machine.machine, eEnablePan);
    } else if (event->type == GDK_BUTTON_PRESS && event->button == 1) {
        ufsm_process(&priv->machine.machine, eLMBDown);
    }

    if (event->type == GDK_DOUBLE_BUTTON_PRESS) {
        if (priv->selection == UFSMM_SELECTION_REGION) {
            if (priv->selected_region->off_page) {
                L_DEBUG("Switching view to region '%s'", priv->selected_region->name);
                priv->current_region->draw_as_root = false;
                priv->selected_region->draw_as_root = true;
                priv->current_region = priv->selected_region;
                if (priv->current_region->scale == 0)
                    priv->current_region->scale = 1.0;
                priv->redraw = true;
            }
        }
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

static gboolean buttonrelease_cb(GtkWidget *widget, GdkEventButton *event)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->type == GDK_BUTTON_RELEASE && event->button == 3) {
        ufsm_process(&priv->machine.machine, eDisablePan);
    } else if (event->type == GDK_BUTTON_RELEASE && event->button == 1) {
        ufsm_process(&priv->machine.machine, eLMBUp);
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

static gboolean scroll_event_cb(GtkWidget *widget, GdkEventScroll *event)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->direction == GDK_SCROLL_UP)
        canvas_machine_process(&priv->machine, eScrollUp);
    else if (event->direction == GDK_SCROLL_DOWN)
        canvas_machine_process(&priv->machine, eScrollDown);

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }

    return TRUE;
}

static gboolean motion_notify_event_cb(GtkWidget      *widget,
                                       GdkEventMotion *event,
                                       gpointer        data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    double px = event->x / priv->current_region->scale;
    double py = event->y / priv->current_region->scale;
    priv->px = px;
    priv->py = py;

    priv->dx = px - priv->sx;
    priv->dy = py - priv->sy;

    //L_DEBUG("dx %.2f dy %.2f", priv->dx, priv->dy);

    ufsm_process(&priv->machine.machine, eMotion);

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }

    return TRUE;
}

static void draw_cb(GtkWidget *widget, cairo_t *cr, gpointer data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    gint width, height;
    gint i;
    GtkAllocation allocation;

    gtk_widget_get_allocation(widget, &allocation);

    width = allocation.width;
    height = allocation.height;

    priv->cr = cr;
    ufsmm_canvas_render(priv, width, height);
}

static void debug_event(int ev)
{
    if (ev == eMotion)
        return;

    printf (" %-3i|            |\n",ev);
}

GtkWidget* ufsmm_canvas_new(GtkWidget *parent)
{
    GtkWidget *widget = NULL;
    struct ufsmm_canvas *priv = NULL;

    priv = malloc(sizeof(*priv));

    if (priv == NULL) {
        return NULL;
    }

    memset(priv, 0, sizeof(*priv));

    ufsm_debug_machine(&priv->machine.machine);
    /* Override the debug_event to filter out 'eMotion' -event, since
     * there are so many of them */
    priv->machine.machine.debug_event = debug_event;

    canvas_machine_initialize(&priv->machine, priv);

    widget = gtk_drawing_area_new();

    g_object_set_data(G_OBJECT(widget), "canvas private", priv);

    priv->widget = widget;
    priv->root_window = parent;

    gtk_widget_set_events (widget, gtk_widget_get_events (widget)
                                     | GDK_BUTTON_PRESS_MASK
                                     | GDK_BUTTON_RELEASE_MASK
                                     | GDK_SCROLL_MASK
                                     | GDK_POINTER_MOTION_MASK);

    /* Event signals */
    g_signal_connect(G_OBJECT(widget), "key_press_event",
                     G_CALLBACK (keypress_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "key_release_event",
                     G_CALLBACK (keyrelease_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "button_press_event",
                     G_CALLBACK (buttonpress_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "button_release_event",
                     G_CALLBACK (buttonrelease_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "button_release_event",
                     G_CALLBACK (buttonrelease_cb), NULL);

    g_signal_connect (G_OBJECT(widget), "motion-notify-event",
                    G_CALLBACK (motion_notify_event_cb), NULL);

    g_signal_connect (G_OBJECT(widget), "scroll_event",
                    G_CALLBACK (scroll_event_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "draw", G_CALLBACK(draw_cb), NULL);

    gtk_widget_set_can_focus(widget, TRUE);
    gtk_widget_set_focus_on_click(widget, TRUE);
    gtk_widget_grab_focus(widget);

    return widget;
}

void ufsmm_canvas_free(GtkWidget *widget)
{
}

int ufsmm_canvas_load_model(GtkWidget *widget, struct ufsmm_model *model)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    priv->model = model;
    priv->selected_region = model->root;
    priv->current_region = model->root;
    priv->current_region->draw_as_root = true;
    priv->current_region->scale = 1.0;

    return 0;
}
