#include <stdio.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include <gtk/gtk.h>
#include "controller.h"
#include "render.h"
#include "utils.h"
#include "logic/canvas.h"

#include "dialogs/edit_state_dialog.h"
#include "dialogs/add_action_dialog.h"
#include "dialogs/add_guard_dialog.h"
#include "dialogs/edit_string_dialog.h"
#include "dialogs/set_trigger_dialog.h"

struct transition_ref {
    struct ufsmm_transition *transition;
    struct ufsmm_transition_state_ref old_source_ref;
    struct ufsmm_transition_state_ref old_dest_ref;
    TAILQ_ENTRY(transition_ref) tailq;
};

TAILQ_HEAD(transition_refs, transition_ref);

static void add_transition_ref(struct transition_refs *list,
                               struct ufsmm_transition *transition)
{
    struct transition_ref *new = malloc(sizeof(struct transition_ref));
    if (new == NULL)
        return;
    memset(new, 0, sizeof(*new));
    new->transition = transition;
    memcpy(&new->old_source_ref, &transition->source, sizeof(transition->source));
    memcpy(&new->old_dest_ref, &transition->dest, sizeof(transition->dest));
    TAILQ_INSERT_TAIL(list, new, tailq);
}

int canvas_state_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return ((priv->selection == UFSMM_SELECTION_STATE) &&
           (priv->selected_state != NULL));
}

int canvas_state_resize_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selected_corner != UFSMM_NO_SELECTION);
}

int canvas_region_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_REGION);
}

struct resize_op
{
    struct transition_refs transitions;
};

void canvas_resize_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r, *r2;
    struct ufsmm_transition *t;
    struct ufsmm_stack *stack;

    priv->command_data = malloc(sizeof(struct resize_op));

    if (priv->command_data == NULL)
        return;

    memset(priv->command_data, 0, sizeof(struct resize_op));
    struct resize_op *op = (struct resize_op *) priv->command_data;

    TAILQ_INIT(&op->transitions);

    s->tx = s->x;
    s->ty = s->y;
    s->tw = s->w;
    s->th = s->h;

    TAILQ_FOREACH(t, &s->transitions, tailq) {
        t->source.toffset = t->source.offset;
        t->source.tside = t->source.side;
        t->source.tstate = t->source.state;
        add_transition_ref(&op->transitions, t);
    }

    /* Locate transitions that have this state as their destination */
    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if (t->dest.state == priv->selected_state) {
                    L_DEBUG("Found state: %s", t->source.state->name);
                    t->dest.toffset = t->dest.offset;
                    t->dest.tside = t->dest.side;
                    t->dest.tstate = t->dest.state;
                    add_transition_ref(&op->transitions, t);
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (!r->off_page) {
                    ufsmm_stack_push(stack, r2);
                }
            }
        }
    }

    ufsmm_stack_free(stack);
}

void canvas_resize_state_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct resize_op *op = (struct resize_op *) priv->command_data;
    struct transition_ref *item;
    struct transition_refs *list = &op->transitions;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_resize_state(undo_ops, priv->selected_state);

    TAILQ_FOREACH(item, &op->transitions, tailq) {
        struct ufsmm_transition *t = item->transition;
        if (t->dest.changed) {
            ufsmm_undo_move_transition_dest(undo_ops, t, &item->old_dest_ref);
        } else if (t->source.changed) {
            ufsmm_undo_move_transition_source(undo_ops, t, &item->old_source_ref);
        }
    }

    ufsmm_undo_commit_ops(priv->undo, undo_ops);

    while (item = TAILQ_FIRST(list)) {
        TAILQ_REMOVE(list, item, tailq);
        free(item);
    }

    free(priv->command_data);
    priv->command_data = NULL;
}

void canvas_resize_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->current_region;
    struct resize_op *op = (struct resize_op *) priv->command_data;
    struct transition_ref *tref;
    double dy = priv->dy;
    double dx = priv->dx;
    struct ufsmm_state *selected_state = priv->selected_state;

    priv->redraw = true;

    if (selected_state->kind == UFSMM_STATE_NORMAL) {
                struct transition_ref *tref;
        switch (priv->selected_corner) {
            case UFSMM_TOP_LEFT:
            {
                TAILQ_FOREACH(tref, &op->transitions, tailq) {
                    struct ufsmm_transition *t = tref->transition;
                    if (t->source.state == priv->selected_state) {

                        if ((t->source.side == UFSMM_SIDE_LEFT) ||
                             (t->source.side == UFSMM_SIDE_RIGHT)) {
                            t->source.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->source.toffset - dy);
                            t->source.changed = true;
                        } else if ((t->source.side == UFSMM_SIDE_TOP) ||
                             (t->source.side == UFSMM_SIDE_BOTTOM)) {
                            t->source.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->source.toffset - dx);
                            t->source.changed = true;
                        }
                    } else if (t->dest.state == priv->selected_state) {
                        if ((t->dest.side == UFSMM_SIDE_LEFT) ||
                               (t->dest.side == UFSMM_SIDE_RIGHT)) {
                            t->dest.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->dest.toffset - dy);
                            t->dest.changed = true;
                        } else if ((t->dest.side == UFSMM_SIDE_TOP) ||
                               (t->dest.side == UFSMM_SIDE_BOTTOM)) {
                            t->dest.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->dest.toffset - dx);
                            t->dest.changed = true;
                        }
                    }
                }
            }
            break;
            case UFSMM_LEFT_MIDDLE:
            case UFSMM_BOT_LEFT:
            {
                TAILQ_FOREACH(tref, &op->transitions, tailq) {
                    struct ufsmm_transition *t = tref->transition;
                    if (t->source.state == priv->selected_state) {

                        if ((t->source.side == UFSMM_SIDE_TOP) ||
                             (t->source.side == UFSMM_SIDE_BOTTOM)) {
                            t->source.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->source.toffset - dx);
                            t->source.changed = true;
                        }
                    } else if (t->dest.state == priv->selected_state) {
                        if ((t->dest.side == UFSMM_SIDE_TOP) ||
                               (t->dest.side == UFSMM_SIDE_BOTTOM)) {
                            t->dest.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->dest.toffset - dx);
                            t->dest.changed = true;
                        }
                    }
                }
            }
            break;
            case UFSMM_TOP_MIDDLE:
            case UFSMM_TOP_RIGHT:
            {
                TAILQ_FOREACH(tref, &op->transitions, tailq) {
                    struct ufsmm_transition *t = tref->transition;
                    if (t->source.state == priv->selected_state) {

                        if ((t->source.side == UFSMM_SIDE_LEFT) ||
                             (t->source.side == UFSMM_SIDE_RIGHT)) {
                            t->source.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->source.toffset - dy);
                            t->source.changed = true;
                        }
                    } else if (t->dest.state == priv->selected_state) {
                        if ((t->dest.side == UFSMM_SIDE_LEFT) ||
                               (t->dest.side == UFSMM_SIDE_RIGHT)) {
                            t->dest.offset = \
                                 ufsmm_canvas_nearest_grid_point(t->dest.toffset - dy);
                            t->dest.changed = true;
                        }
                    }
                }
            }
            break;
        }

        switch (priv->selected_corner) {
            case UFSMM_TOP_MIDDLE:
                selected_state->h = selected_state->th - dy;
                selected_state->y = selected_state->ty + dy;
            break;
            case UFSMM_BOT_MIDDLE:
                selected_state->h = selected_state->th + dy;
            break;
            case UFSMM_TOP_RIGHT:
                selected_state->h = selected_state->th - dy;
                selected_state->w = selected_state->tw + dx;
                selected_state->y = selected_state->ty + dy;
            break;
            case UFSMM_RIGHT_MIDDLE:
                selected_state->w = selected_state->tw + dx;
            break;
            case UFSMM_LEFT_MIDDLE:
                selected_state->w = selected_state->tw - dx;
                selected_state->x = selected_state->tx + dx;
            break;
            case UFSMM_BOT_RIGHT:
                selected_state->w = selected_state->tw + dx;
                selected_state->h = selected_state->th + dy;
            break;
            case UFSMM_BOT_LEFT:
                selected_state->w = selected_state->tw - dx;
                selected_state->x = selected_state->tx + dx;
                selected_state->h = selected_state->th + dy;
            break;
            case UFSMM_TOP_LEFT:
                selected_state->w = selected_state->tw - dx;
                selected_state->x = selected_state->tx + dx;
                selected_state->h = selected_state->th - dy;
                selected_state->y = selected_state->ty + dy;
            break;
        }

        if (selected_state->w < 50)
            selected_state->w = 50;

        if (selected_state->h < 50)
            selected_state->h = 50;

    } else if ((selected_state->kind == UFSMM_STATE_JOIN) ||
               (selected_state->kind == UFSMM_STATE_FORK)) {

        switch (priv->selected_corner) {
            case UFSMM_TOP_LEFT:
                if (selected_state->orientation == UFSMM_ORIENTATION_HORIZONTAL) {
                    if (selected_state->tw - dx > 50) {
                        selected_state->w = selected_state->tw - dx;
                        selected_state->x = selected_state->tx + dx;
                    }
                } else {
                    if (selected_state->th - dy > 50) {
                        selected_state->h = selected_state->th - dy;
                        selected_state->y = selected_state->ty + dy;
                    }
                }
            break;
            case UFSMM_TOP_RIGHT:
                if (selected_state->orientation == UFSMM_ORIENTATION_HORIZONTAL) {
                    if (selected_state->tw + dx > 50)
                        selected_state->w = selected_state->tw + dx;
                } else {
                    if (selected_state->th + dy > 50)
                        selected_state->h = selected_state->th + dy;
                }
            break;
       }
    }

    selected_state->x = ufsmm_canvas_nearest_grid_point(selected_state->x);
    selected_state->y = ufsmm_canvas_nearest_grid_point(selected_state->y);
    selected_state->w = ufsmm_canvas_nearest_grid_point(selected_state->w);
    selected_state->h = ufsmm_canvas_nearest_grid_point(selected_state->h);
}

int canvas_region_resize_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selected_corner != UFSMM_NO_SELECTION);
}

int canvas_state_entry_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_ENTRY);
}

int canvas_transition_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    return (priv->selection == UFSMM_SELECTION_TRANSITION);
}

int canvas_transition_selected2(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    return (priv->selection == UFSMM_SELECTION_TRANSITION) &&
            (priv->selected_transition_vertice != UFSMM_TRANSITION_VERTICE);
}

int canvas_transition_vertice_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *r = priv->current_region;
    double vsx, vsy, vex, vey;
    double tsx, tsy, tex, tey;
    double ox = r->ox;
    double oy = r->oy;

    priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_NONE;

    transition_calc_begin_end_point(t->source.state,
                                    t->source.side,
                                    t->source.offset,
                                    &tsx, &tsy);
    transition_calc_begin_end_point(t->dest.state,
                                    t->dest.side,
                                    t->dest.offset,
                                    &tex, &tey);

    vex = tex + ox;
    vey = tey + oy;

    vsx = tsx + ox;
    vsy = tsy + oy;

    if (point_in_box(priv->px, priv->py, vsx, vsy, 10, 10)) {
        L_DEBUG("Start vertice selected");
        priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_START;
        t->source.toffset = t->source.offset;
    }

    struct ufsmm_vertice *v;
    TAILQ_FOREACH(v, &t->vertices, tailq) {
        if (point_in_box(priv->px, priv->py, v->x + ox, v->y + oy, 10, 10)) {
            L_DEBUG("Vertice selected");
            priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE;
            priv->selected_transition_vertice_data = v;
            v->tx = v->x;
            v->ty = v->y;
        }
    }

    if (point_in_box(priv->px, priv->py, vex, vey, 10, 10)) {
        priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_END;
        L_DEBUG("End vertice selected");
        t->dest.toffset = t->dest.offset;
    }

    return (priv->selected_transition_vertice != UFSMM_TRANSITION_VERTICE_NONE);
}

int canvas_transition_text_block_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    bool selected = false;
    double ox, oy;

    ox = priv->current_region->ox;
    oy = priv->current_region->oy;

    double tx = t->text_block_coords.x + ox;
    double ty = t->text_block_coords.y + oy + 20;
    double tw = t->text_block_coords.w;
    double th = t->text_block_coords.h;

    if (point_in_box2(priv->px, priv->py, tx - 10, ty - 10, tw + 20, th + 20)) {
        t->text_block_coords.tx = t->text_block_coords.x;
        t->text_block_coords.ty = t->text_block_coords.y;
        t->text_block_coords.tw = t->text_block_coords.w;
        t->text_block_coords.th = t->text_block_coords.h;
        selected = true;
    }

    if (selected) {
        if (point_in_box(priv->px, priv->py, tx, ty, 10, 10)) {
            priv->selected_corner = UFSMM_TOP_LEFT;
            L_DEBUG("UFSMM_TOP_LEFT");
        } else if (point_in_box(priv->px, priv->py, tx + tw, ty, 10, 10)) {
            priv->selected_corner = UFSMM_TOP_RIGHT;
            L_DEBUG("UFSMM_TOP_RIGHT");
        } else if (point_in_box(priv->px, priv->py, tx + tw, ty + th, 10, 10)) {
            priv->selected_corner = UFSMM_BOT_RIGHT;
            L_DEBUG("UFSMM_BOT_RIGHT");
        } else if (point_in_box(priv->px, priv->py, tx, ty + th, 10, 10)) {
            priv->selected_corner = UFSMM_BOT_LEFT;
            L_DEBUG("UFSMM_BOT_LEFT");
        } else {
            priv->selected_corner = UFSMM_NO_SELECTION;
            L_DEBUG("UFSMM_NO_SELECTION");
        }
    }

    return selected;
}

void canvas_reset_selection2(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    canvas_reset_selection(context);

    switch (priv->selection) {
        case UFSMM_SELECTION_REGION:
            L_DEBUG("region");
            priv->selected_region->selected = true;
            priv->redraw = true;
        break;
        case UFSMM_SELECTION_STATE:
            L_DEBUG("state");
            priv->selected_state->selected = true;
            priv->redraw = true;
        break;
        case UFSMM_SELECTION_TRANSITION:
            priv->selected_transition->selected = true;
            priv->redraw = true;
        break;
        default:
        break;
    }
}

void canvas_reset_selection(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s;
    struct ufsmm_region *r, *r2;
    struct ufsmm_transition *t;
    struct ufsmm_stack *stack;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        r->selected = false;
        TAILQ_FOREACH(s, &r->states, tailq) {
            s->selected = false;

            TAILQ_FOREACH(t, &s->transitions, tailq) {
                t->selected = false;
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    priv->selection_count = 0;
    priv->redraw = true;
    ufsmm_stack_free(stack);
}


int canvas_selection_count(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return priv->selection_count;
}

int canvas_clicked_on_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_state *selected_state;
    struct ufsmm_region *selected_region;
    struct ufsmm_coords *selected_text_block;
    double x, y, w, h;
    double ox, oy;
    int result = 0;

    ox = priv->current_region->ox;
    oy = priv->current_region->oy;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    /* Check states and regions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);

        if (result)
            continue;

        if (r->draw_as_root != true) {
            if (point_in_box2(priv->px - priv->current_region->ox,
                              priv->py - priv->current_region->oy,
                                    x - 3, y - 3, w + 3, h + 10)) {

                if (r->selected) {
                    result = 1;
                    continue;
                }

            }
        }

        if (r->off_page && !r->draw_as_root)
            continue;

        TAILQ_FOREACH(s, &r->states, tailq) {
            if (point_in_box2(priv->px - priv->current_region->ox,
                              priv->py - priv->current_region->oy,
                                   s->x - 5, s->y - 5, s->w + 10, s->h + 10)) {
                if (s->selected) {
                    result = 1;
                    continue;
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);
    return result;
}

void canvas_process_selection(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_state *selected_state;
    struct ufsmm_region *selected_region;
    struct ufsmm_coords *selected_text_block;
    enum ufsmm_resize_selector selected_text_block_corner;
    struct ufsmm_action_ref *selected_action_ref = NULL;
    double x, y, w, h;
    double ox, oy;

    ox = priv->current_region->ox;
    oy = priv->current_region->oy;

    priv->selection = UFSMM_SELECTION_NONE;
    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    /* Check states and regions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);

        if (r->draw_as_root != true) {
            if (point_in_box2(priv->px - priv->current_region->ox,
                              priv->py - priv->current_region->oy,
                                                x + 5, y + 5, w - 5, h)) {
                L_DEBUG("Region '%s' selected", r->name);
                priv->selection = UFSMM_SELECTION_REGION;
                priv->selected_region = r;
            }
        }

        if (r->off_page && !r->draw_as_root)
            continue;

        TAILQ_FOREACH(s, &r->states, tailq) {
            if (point_in_box2(priv->px - priv->current_region->ox,
                              priv->py - priv->current_region->oy,
                                   s->x - 5, s->y - 5, s->w + 10, s->h + 10)) {
                L_DEBUG("State '%s' selected", s->name);

                priv->selection = UFSMM_SELECTION_STATE;
                priv->selected_state = s;
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    /* Check transitions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        if (r->off_page && !r->draw_as_root)
            continue;

        TAILQ_FOREACH(s, &r->states, tailq) {
            struct ufsmm_transition *t;
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                struct ufsmm_vertice *v;
                double vsx, vsy, vex, vey;
                double tsx, tsy, tex, tey;
                double d;

                //L_DEBUG("Checking transitions from %s", s->name);
                transition_calc_begin_end_point(s,
                                                t->source.side,
                                                t->source.offset,
                                                &tsx, &tsy);
                transition_calc_begin_end_point(t->dest.state,
                                                t->dest.side,
                                                t->dest.offset,
                                                &tex, &tey);

                vsx = tsx + ox;
                vsy = tsy + oy;

                if (t->vertices.tqh_first != NULL) {
                    TAILQ_FOREACH(v, &t->vertices, tailq) {
                        vex = v->x + ox;
                        vey = v->y + oy;

                        d = distance_point_to_seg(priv->px, priv->py,
                                                  vsx, vsy,
                                                  vex, vey);

                        //L_DEBUG("Segment d = %.2f", d);
                        if (d < 10.0) {
                            priv->selection = UFSMM_SELECTION_TRANSITION;
                            priv->selected_transition = t;
                            break;
                        }
                        vsx = v->x + ox;
                        vsy = v->y + oy;
                    }
                    vsx = vex;
                    vsy = vey;
                }
                vex = tex + ox;
                vey = tey + oy;

                d = distance_point_to_seg(priv->px, priv->py,
                                          vsx, vsy,
                                          vex, vey);

                if (d < 10.0) {
                    priv->selection = UFSMM_SELECTION_TRANSITION;
                    priv->selected_transition = t;
                }
                double tx = t->text_block_coords.x + ox;
                double ty = t->text_block_coords.y + oy + 20;
                double tw = t->text_block_coords.w;
                double th = t->text_block_coords.h;

                if (point_in_box2(priv->px, priv->py, tx - 10, ty - 10, tw + 20, th + 20)) {
                    L_DEBUG("Text-box selected <%.2f, %.2f> <%.2f, %.2f, %.2f, %.2f>",
                                priv->px, priv->py, tx, ty, tx + tw, ty + th);
                    priv->selection = UFSMM_SELECTION_TRANSITION;

                    priv->selected_transition = t;
                    selected_text_block = &t->text_block_coords;

                    if (point_in_box(priv->px, priv->py, tx, ty, 10, 10)) {
                        selected_text_block_corner = UFSMM_TOP_LEFT;
                    } else if (point_in_box(priv->px, priv->py, tx + tw, ty, 10, 10)) {
                        selected_text_block_corner = UFSMM_TOP_RIGHT;
                    } else if (point_in_box(priv->px, priv->py, tx + tw, ty + th, 10, 10)) {
                        selected_text_block_corner = UFSMM_BOT_RIGHT;
                    } else if (point_in_box(priv->px, priv->py, tx, ty + th, 10, 10)) {
                        selected_text_block_corner = UFSMM_BOT_LEFT;
                    } else {
                        selected_text_block_corner = UFSMM_NO_SELECTION;
                    }
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }
    priv->redraw = true;
    ufsmm_stack_free(stack);
}

void canvas_focus_selection(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    switch (priv->selection) {
        case UFSMM_SELECTION_REGION:
            if (priv->selected_region->selected) {
                priv->selected_region->selected = false;
                priv->selection_count--;
            } else {
                priv->selected_region->selected = true;
                priv->selection_count++;
            }
            priv->redraw = true;
        break;
        case UFSMM_SELECTION_STATE:
        {
            if (priv->selected_state->selected) {
                priv->selected_state->selected = false;
                priv->selection_count--;
            } else {
                priv->selected_state->selected = true;
                priv->selection_count++;
            }
            priv->redraw = true;
        }
        break;
        case UFSMM_SELECTION_TRANSITION:
            if (priv->selected_transition->selected) {
                priv->selected_transition->selected = false;
                priv->selection_count--;
            } else {
                priv->selected_transition->selected = true;
                priv->selection_count++;
            }
            priv->redraw = true;
        break;
        default:
        break;
    }
}

void canvas_save(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s: writing to '%s'", __func__, priv->model->filename);
    ufsmm_model_write(priv->model->filename, priv->model);
}

void canvas_rotate_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;

    if ((s->kind == UFSMM_STATE_JOIN) || (s->kind == UFSMM_STATE_FORK)) {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

        if ((s->orientation == UFSMM_ORIENTATION_NA) ||
            (s->orientation == UFSMM_ORIENTATION_VERTICAL)) {
            L_DEBUG("Rotating from vertical to horizontal w=%.2f h=%.2f", s->w, s->h);
            s->torientation = s->orientation;
            s->tw = s->w;
            s->th = s->h;
            s->tx = s->x;
            s->ty = s->y;
            s->tparent_region = s->parent_region;

            s->orientation = UFSMM_ORIENTATION_HORIZONTAL;
            s->w = s->h;
            s->h = 10;

            ufsmm_undo_resize_state(undo_ops, s);
        } else {
            L_DEBUG("Rotating from horizontal to vertical w=%.2f h=%.2f", s->w, s->h);
            s->torientation = s->orientation;
            s->tw = s->w;
            s->th = s->h;
            s->tx = s->x;
            s->ty = s->y;
            s->tparent_region = s->parent_region;
            s->orientation = UFSMM_ORIENTATION_VERTICAL;
            s->h = s->w;
            s->w = 10;

            ufsmm_undo_resize_state(undo_ops, s);
        }
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
        priv->redraw = true;
    }

}

void canvas_check_sresize_boxes(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    double x, y, w, h;
    double px = priv->px;
    double py = priv->py;

    //ufsmm_get_state_absolute_coords(priv->selected_state, &x, &y, &w, &h);

    x = priv->selected_state->x + r->ox;
    y = priv->selected_state->y + r->oy;
    w = priv->selected_state->w;
    h = priv->selected_state->h;

    /* Check re-size boxes */

    if (s->kind == UFSMM_STATE_NORMAL) {
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
    } else if ((s->kind == UFSMM_STATE_JOIN) ||
               (s->kind == UFSMM_STATE_FORK)) {
        L_DEBUG("Checking join corners");
        if (s->orientation == UFSMM_ORIENTATION_HORIZONTAL) {
            if (point_in_box(px, py, x, y + h/2, 10, 10)) {
                priv->selected_corner = UFSMM_TOP_LEFT;
            } else if (point_in_box(px, py, x + w, y + h/2, 10, 10)) {
                priv->selected_corner = UFSMM_TOP_RIGHT;
            } else {
                priv->selected_corner = UFSMM_NO_SELECTION;
            }
        } else {
            if (point_in_box(px, py, x + 5, y + h , 10, 10)) {
                priv->selected_corner = UFSMM_TOP_RIGHT;
            } else if (point_in_box(px, py, x + 5, y, 10, 10)) {
                priv->selected_corner = UFSMM_TOP_LEFT;
            } else {
                priv->selected_corner = UFSMM_NO_SELECTION;
            }
        }
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
    struct ufsmm_action_ref *ar;

    if (priv->selected_aref != NULL) {
        priv->selected_aref->selected = false;
        priv->selected_aref = NULL;
    }

    if ((priv->selection == UFSMM_SELECTION_STATE) &&
        (priv->selected_state->kind == UFSMM_STATE_NORMAL)) {
        /* Check action functions */
        TAILQ_FOREACH(ar, &s->entries, tailq) {
            if (point_in_box2(priv->px, priv->py, ar->x + r->ox, ar->y + r->oy, ar->w, ar->h)) {
                priv->selected_aref = ar;
                priv->selection = UFSMM_SELECTION_ENTRY;
                ar->selected = true;
            } else {
                ar->selected = false;
            }
        }

        TAILQ_FOREACH(ar, &s->exits, tailq) {
            if (point_in_box2(priv->px, priv->py, ar->x + r->ox, ar->y + r->oy, ar->w, ar->h)) {
                priv->selected_aref = ar;
                priv->selection = UFSMM_SELECTION_EXIT;
                ar->selected = true;
            } else {
                ar->selected = false;
            }
        }
    }
}

void canvas_focus_transition(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    L_DEBUG("Transition %s --> %s selected",
                t->source.state->name, t->dest.state->name);
    t->selected = true;
    priv->redraw = true;
}

struct move_vertice_op {
    struct ufsmm_transition *transition;
    struct ufsmm_transition_state_ref old_source;
    struct ufsmm_transition_state_ref old_dest;
};

void canvas_move_vertice_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_vertice *v;
    struct move_vertice_op *op = malloc(sizeof(struct move_vertice_op));

    if (op == NULL)
        return;

    memset(op, 0, sizeof(*op));
    priv->command_data = (void *) op;

    memcpy(&op->old_source, &t->source, sizeof(t->source));
    memcpy(&op->old_dest, &t->dest, sizeof(t->dest));
    op->transition = t;

    TAILQ_FOREACH(v, &t->vertices, tailq) {
        v->tx = v->x;
        v->ty = v->y;
    }
}

void canvas_move_vertice_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_vertice *v;
    struct move_vertice_op *op = (struct move_vertice_op *) priv->command_data;

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

    TAILQ_FOREACH(v, &t->vertices, tailq) {
        if ((v->tx != v->x) || (v->ty != v->y)) {
            ufsmm_undo_move_vertice(undo_ops, v);
        }
    }

    if ((t->source.state != op->old_source.state) ||
        (t->source.offset != op->old_source.offset) ||
        (t->source.side != op->old_source.side)) {
        ufsmm_undo_move_transition_source(undo_ops, t, &op->old_source);
    }

    if ((t->dest.state != op->old_dest.state) ||
        (t->dest.offset != op->old_dest.offset) ||
        (t->dest.side != op->old_dest.side)) {
        ufsmm_undo_move_transition_dest(undo_ops, t, &op->old_dest);
    }
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    free(op);
}

void canvas_move_vertice(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *cr = priv->current_region;

    double dx = priv->dx;
    double dy = priv->dy;
    priv->redraw = true;

    switch (priv->selected_transition_vertice) {
        case UFSMM_TRANSITION_VERTICE_START:
        {
            enum ufsmm_side src_side;
            double src_offset;
            struct ufsmm_state *new_src_state = NULL;

            if (ufsmm_state_get_at_xy(priv->current_region,
                                        priv->px,
                                        priv->py,
                                        &new_src_state, NULL) == UFSMM_OK) {
                if (new_src_state != t->source.state) {
                    L_DEBUG("Switching to new source: %s",
                                    new_src_state->name);
                    ufsmm_transition_change_src_state(t, new_src_state);
                }
            }

            ufsmm_state_get_closest_side(t->source.state,
                                         priv->px, priv->py,
                                         priv->current_region,
                                         &src_side,
                                         &src_offset);

            if (t->source.side != src_side) {
                t->source.side = src_side;
                t->source.toffset = src_offset;
                /* Reset offset and delta when switching sides */
                priv->sx = priv->px;
                priv->sy = priv->py;
                dx = priv->dx;
                dy = priv->dy;
            }

            if (t->source.side == UFSMM_SIDE_LEFT ||
                t->source.side == UFSMM_SIDE_RIGHT) {
                t->source.offset = ufsmm_canvas_nearest_grid_point(t->source.toffset + dy);
            } else {
                t->source.offset = ufsmm_canvas_nearest_grid_point(t->source.toffset + dx);
            }
        }
        break;
        case UFSMM_TRANSITION_VERTICE:
            priv->selected_transition_vertice_data->y = \
                   (priv->selected_transition_vertice_data->ty + dy);
            priv->selected_transition_vertice_data->x = \
                   (priv->selected_transition_vertice_data->tx + dx);

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

            if (ufsmm_state_get_at_xy(priv->current_region,
                                        priv->px,
                                        priv->py,
                                        &new_dest_state, NULL) == UFSMM_OK) {
                if (new_dest_state != t->dest.state) {
                    L_DEBUG("Switching to new destination: %s",
                                    new_dest_state->name);
                    t->dest.state = new_dest_state;
                }
            }

            ufsmm_state_get_closest_side(t->dest.state,
                                         priv->px, priv->py,
                                         priv->current_region,
                                         &dest_side,
                                         &dest_offset);

            if (t->dest.side != dest_side) {
                L_DEBUG("Changing side from %i to %i",
                    t->dest.side, dest_side);
                t->dest.side = dest_side;
                t->dest.toffset = dest_offset;

                /* Reset offset and delta when switching sides */
                priv->sx = priv->px;
                priv->sy = priv->py;
                dx = priv->dx;
                dy = priv->dy;
            }

            if (t->dest.side == UFSMM_SIDE_LEFT ||
                        t->dest.side == UFSMM_SIDE_RIGHT) {
                t->dest.offset = ufsmm_canvas_nearest_grid_point(t->dest.toffset + dy);
            } else {
                t->dest.offset = ufsmm_canvas_nearest_grid_point(t->dest.toffset + dx);
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
    struct ufsmm_guard_ref *ar;

    TAILQ_FOREACH(ar, &t->guards, tailq) {
        ar->selected = false;
    }

    TAILQ_FOREACH(ar, &t->guards, tailq) {
        if (point_in_box2(priv->px, priv->py, ar->x + cr->ox,
                                              ar->y + cr->oy, ar->w, ar->h)) {
            ar->selected = true;
            priv->redraw = true;
            priv->selected_guard = ar;
            priv->selection = UFSMM_SELECTION_GUARD;
            L_DEBUG("Selected guard!");
        }
    }
}

void canvas_check_action(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_action_ref *ar;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *cr = priv->current_region;

    TAILQ_FOREACH(ar, &t->actions, tailq) {
        ar->selected = false;
    }

    TAILQ_FOREACH(ar, &t->actions, tailq) {
        if (point_in_box2(priv->px, priv->py, ar->x + cr->ox,
                                              ar->y + cr->oy, ar->w, ar->h)) {
            ar->selected = true;
            priv->redraw = true;
            priv->selected_aref = ar;
            priv->selection = UFSMM_SELECTION_ACTION;
            L_DEBUG("Selected action!");
        }
    }
}

void canvas_focus_guard(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->redraw = true;
}

void canvas_focus_action(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->redraw = true;
}

void canvas_focus_entry(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->redraw = true;
}

void canvas_focus_exit(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->redraw = true;
}

void canvas_check_text_block(void *context)
{
}

int canvas_guard_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_GUARD);
}

int canvas_action_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_ACTION);
}

int canvas_state_exit_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_EXIT);
}

int canvas_textblock_resize_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selected_corner != UFSMM_NO_SELECTION);
}

int canvas_only_state_selected(void *context)
{
    return false;
}


/* Action function prototypes */
void canvas_select_root_region(void *context)
{
}

void canvas_move_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;
    struct ufsmm_vertice *v;

    L_DEBUG("%s: ", __func__);

    /* Setup selected state */
    state->tx = state->x;
    state->ty = state->y;
    state->tw = state->w;
    state->th = state->h;
    state->tparent_region = state->parent_region;


    /* Check for self transitions */
    TAILQ_FOREACH(t, &state->transitions, tailq) {
        if ((t->source.state == state) &&
            (t->dest.state == state)) {

            t->text_block_coords.tx = t->text_block_coords.x;
            t->text_block_coords.ty = t->text_block_coords.y;

            TAILQ_FOREACH(v,  &t->vertices, tailq) {
                v->tx = v->x;
                v->ty = v->y;
            }
        }
    }

    /* Update possible children */

    static struct ufsmm_stack *stack;
    struct ufsmm_region *r2;
    /* Update possible children */

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
        if (r->off_page == false) {
            ufsmm_stack_push(stack, r);
        }
    }

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            /* Store current position and size */
            s->tx = s->x;
            s->ty = s->y;
            s->tw = s->w;
            s->th = s->h;
            s->tparent_region = s->parent_region;

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page == false) {
                    ufsmm_stack_push(stack, r2);
                }
            }


            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if ((ufsmm_state_is_descendant(t->source.state, priv->selected_state)) &&
                    (ufsmm_state_is_descendant(t->dest.state, priv->selected_state))) {

                    t->text_block_coords.tx = t->text_block_coords.x;
                    t->text_block_coords.ty = t->text_block_coords.y;
                    TAILQ_FOREACH(v,  &t->vertices, tailq) {
                        v->tx = v->x;
                        v->ty = v->y;
                    }
                }
            }
        }
    }

    ufsmm_stack_free(stack);
    printf("State MOVE BEGIN %.2f, %.2f\n", priv->sx, priv->sy);
}

void canvas_move_state_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s: ", __func__);

    /* Undo stuff */
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;
    struct ufsmm_vertice *v;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    s = priv->selected_state;
    ufsmm_undo_resize_state(undo_ops, s);

    TAILQ_FOREACH(t, &s->transitions, tailq) {
        if ((ufsmm_state_is_descendant(t->source.state, priv->selected_state)) &&
            (ufsmm_state_is_descendant(t->dest.state, priv->selected_state))) {
            L_DEBUG("Adding transition %s->%s to undo context",
                            t->source.state->name, t->dest.state->name);
            ufsmm_undo_move_coords(undo_ops, &t->text_block_coords);
            TAILQ_FOREACH(v,  &t->vertices, tailq) {
                ufsmm_undo_move_vertice(undo_ops, v);
            }
        }
    }

    TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
        if (r->off_page == false) {
            ufsmm_stack_push(stack, r);
        }
    }

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_undo_resize_state(undo_ops, s);

            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if ((ufsmm_state_is_descendant(t->source.state, priv->selected_state)) &&
                    (ufsmm_state_is_descendant(t->dest.state, priv->selected_state))) {
                    L_DEBUG("Adding transition %s->%s to undo context",
                                    t->source.state->name, t->dest.state->name);
                    ufsmm_undo_move_coords(undo_ops, &t->text_block_coords);
                    TAILQ_FOREACH(v,  &t->vertices, tailq) {
                        ufsmm_undo_move_vertice(undo_ops, v);
                    }
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page == false) {
                    ufsmm_stack_push(stack, r2);
                }
            }
        }
    }

    ufsmm_stack_free(stack);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
}

void canvas_move_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *new_pr;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    struct ufsmm_transition *t;
    struct ufsmm_vertice *v;
    double x, y, w, h;
    double tx_tmp, ty_tmp;
    double ox, oy;
    int rc;

    s->x = ufsmm_canvas_nearest_grid_point(s->tx + priv->dx);
    s->y = ufsmm_canvas_nearest_grid_point(s->ty + priv->dy);

    /* Move all of the children */

    /* Check if state is dragged on top of another region, if so, re-parent state */
    rc = ufsmm_region_get_at_xy(priv->current_region,
                                    priv->px, priv->py, &new_pr, NULL);

    if (rc == UFSMM_OK && (s->parent_region != new_pr)) {
        L_DEBUG("***** Re-parent '%s' to region: %s", s->name, new_pr->name);
        ufsmm_state_move_to_region(priv->model, s, new_pr);
    }

    /* Check for self transitions */
    TAILQ_FOREACH(t, &s->transitions, tailq) {
        if ((t->source.state == s) &&
            (t->dest.state == s)) {

            t->text_block_coords.x = \
                ufsmm_canvas_nearest_grid_point(t->text_block_coords.tx + priv->dx);
            t->text_block_coords.y = \
                ufsmm_canvas_nearest_grid_point(t->text_block_coords.ty + priv->dy);

            TAILQ_FOREACH(v,  &t->vertices, tailq) {
                v->x = ufsmm_canvas_nearest_grid_point(v->tx + priv->dx);
                v->y = ufsmm_canvas_nearest_grid_point(v->ty + priv->dy);
            }
        }
    }

    static struct ufsmm_stack *stack;
    struct ufsmm_region *r2;
    /* Update possible children */

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
        if (r->off_page == false) {
            ufsmm_stack_push(stack, r);
        }
    }

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            /* Store current position and size */
            s->x = ufsmm_canvas_nearest_grid_point(s->tx + priv->dx);
            s->y = ufsmm_canvas_nearest_grid_point(s->ty + priv->dy);

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page == false) {
                    ufsmm_stack_push(stack, r2);
                }
            }

            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if ((ufsmm_state_is_descendant(t->source.state, priv->selected_state)) &&
                    (ufsmm_state_is_descendant(t->dest.state, priv->selected_state))) {

                    t->text_block_coords.x = \
                        ufsmm_canvas_nearest_grid_point(t->text_block_coords.tx + priv->dx);
                    t->text_block_coords.y = \
                        ufsmm_canvas_nearest_grid_point(t->text_block_coords.ty + priv->dy);

                    TAILQ_FOREACH(v,  &t->vertices, tailq) {
                        v->x = ufsmm_canvas_nearest_grid_point(v->tx + priv->dx);
                        v->y = ufsmm_canvas_nearest_grid_point(v->ty + priv->dy);
                    }
                }
            }
        }
    }

    ufsmm_stack_free(stack);
    priv->redraw = true;
}

void canvas_resize_region_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->selected_region;
    r->th = r->h;
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
            r->h = r->th - dy;
        break;
        case UFSMM_BOT_MIDDLE:
            r->h = r->th + dy;
        break;
        default:
        break;
    }

    r->h = ufsmm_canvas_nearest_grid_point(r->h);
}

void ufsmm_canvas_reset_delta(struct ufsmm_canvas *canvas)
{
    canvas->sx = canvas->px;
    canvas->sy = canvas->py;
}

void canvas_reset_delta(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    ufsmm_canvas_reset_delta(priv);
}

static bool state_has_selected_parent(struct ufsmm_state *state)
{
    bool result = false;

    while (state) {
        if (state->parent_region->parent_state) {
            if (state->parent_region->selected) {
                result = true;
                break;
            }
            state = state->parent_region->parent_state;
        } else {
            break;
        }

        if (state->selected) {
            result = true;
            break;
        }
    }
    return result;
}

static bool region_has_selected_parent(struct ufsmm_region *region)
{
    bool result = false;

    while (region) {
        if (region->parent_state) {
            if (region->parent_state->selected) {
                result = true;
                break;
            }
            region = region->parent_state->parent_region;
        } else {
            break;
        }

        if (region->selected) {
            result = true;
            break;
        }
    }
    return result;
}

void canvas_mselect_delete(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_stack *stack, *sr, *ss, *st;
    struct ufsmm_state *s;
    struct ufsmm_region *r, *r2;
    struct ufsmm_transition *t;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    ufsmm_stack_init(&sr, UFSMM_MAX_R_S);
    ufsmm_stack_init(&ss, UFSMM_MAX_R_S);
    ufsmm_stack_init(&st, UFSMM_MAX_R_S);

    ufsmm_stack_push(stack, (void *) priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        if (r->selected && !region_has_selected_parent(r)) {
            L_DEBUG("Going to delete region %s", r->name);
            ufsmm_stack_push(sr, (void *) r);
        }
        TAILQ_FOREACH(s, &r->states, tailq) {
            if (s->selected && !state_has_selected_parent(s)) {
                L_DEBUG("Going to delete state %s", s->name);
                ufsmm_stack_push(ss, (void *) s);
            }
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if (t->selected) {
                    L_DEBUG("Going to delete transition %s->%s",
                            t->source.state->name, t->dest.state->name);

                    ufsmm_stack_push(st, (void *) t);
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    while (ufsmm_stack_pop(st, (void **) &t) == UFSMM_OK) {
        ufsmm_transition_free_one(t);
    }

    while (ufsmm_stack_pop(ss, (void **) &s) == UFSMM_OK) {
        ufsmm_model_delete_state(priv->model, s);
    }

    while (ufsmm_stack_pop(sr, (void **) &r) == UFSMM_OK) {
        ufsmm_model_delete_region(priv->model, r);
    }
    ufsmm_stack_free(stack);
    ufsmm_stack_free(sr);
    ufsmm_stack_free(ss);
    ufsmm_stack_free(st);
}

void canvas_resize_region_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_resize_region(undo_ops, priv->selected_region);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
}

void canvas_move_text_block_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
}

void canvas_move_text_block_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_move_coords(undo_ops, &t->text_block_coords);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
}

void canvas_move_text_block(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    t->text_block_coords.x = ufsmm_canvas_nearest_grid_point(t->text_block_coords.tx + priv->dx);
    t->text_block_coords.y = ufsmm_canvas_nearest_grid_point(t->text_block_coords.ty + priv->dy);

    priv->redraw = true;
}

struct reorder_guard_op {
    struct ufsmm_transition *transition;
    struct ufsmm_guard_ref *guard, *prev, *next;
};

void canvas_reorder_guard_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *transition = priv->selected_transition;
    struct ufsmm_guard_ref *guard = priv->selected_guard;

    struct reorder_guard_op *op = malloc(sizeof(struct reorder_guard_op));

    if (op == NULL) {
        L_ERR("Could not allocate");
        return;
    }

    memset(op, 0, sizeof(*op));
    priv->command_data = (void *) op;
    op->transition = transition;
    op->guard = guard;
    op->prev = TAILQ_PREV(guard, ufsmm_guard_refs, tailq);
    op->next = TAILQ_NEXT(guard, tailq);
}

void canvas_reorder_guard_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *transition = priv->selected_transition;
    struct ufsmm_guard_ref *guard = priv->selected_guard;
    struct reorder_guard_op *op = (struct reorder_guard_op *) priv->command_data;

    if ((op->prev != TAILQ_PREV(guard, ufsmm_guard_refs, tailq)) ||
        (op->next != TAILQ_NEXT(guard, tailq))) {

        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_reorder_guard(undo_ops, op->transition,
                                           op->guard,
                                           op->prev,
                                           op->next);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
}

void canvas_reorder_guard_func(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *transition = priv->selected_transition;
    struct ufsmm_guard_ref *guard = priv->selected_guard;
    struct ufsmm_guard_ref *next, *prev;

    if (priv->dx > 10.0) {
        ufsmm_canvas_reset_delta(priv);
        next = TAILQ_NEXT(guard, tailq);
        if (next) {
            TAILQ_REMOVE(&transition->guards, guard, tailq);
            TAILQ_INSERT_AFTER(&transition->guards, next, guard, tailq);
            priv->redraw = true;
        }
    } else if (priv->dx < -10.0) {
        ufsmm_canvas_reset_delta(priv);
        prev = TAILQ_PREV(guard, ufsmm_guard_refs, tailq);

        if (prev) {
            TAILQ_REMOVE(&transition->guards, guard, tailq);
            TAILQ_INSERT_BEFORE(prev, guard, tailq);
            priv->redraw = true;
        }
    }
}

struct reorder_aref_op {
    struct ufsmm_action_refs *list;
    struct ufsmm_action_ref *aref, *prev, *next;
};

void canvas_reorder_action_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *transition = priv->selected_transition;
    struct ufsmm_action_ref *aref = priv->selected_aref;

    struct reorder_aref_op *op = malloc(sizeof(struct reorder_aref_op));

    if (op == NULL) {
        L_ERR("Could not allocate");
        return;
    }

    memset(op, 0, sizeof(*op));
    priv->command_data = (void *) op;
    op->list = &transition->actions;
    op->aref = aref;
    op->prev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);
    op->next = TAILQ_NEXT(aref, tailq);
}

void canvas_reorder_action_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *transition = priv->selected_transition;
    struct ufsmm_action_ref *aref = priv->selected_aref;
    struct reorder_aref_op *op = (struct reorder_aref_op *) priv->command_data;

    if ((op->prev != TAILQ_PREV(aref, ufsmm_action_refs, tailq)) ||
        (op->next != TAILQ_NEXT(aref, tailq))) {

        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_reorder_aref(undo_ops, op->list,
                                           op->aref,
                                           op->prev,
                                           op->next);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
}

void canvas_reorder_action_func(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *transition = priv->selected_transition;
    struct ufsmm_action_ref *aref = priv->selected_aref;
    struct ufsmm_action_ref *next, *prev;

    if (priv->dx > 10.0) {
        ufsmm_canvas_reset_delta(priv);
        next = TAILQ_NEXT(aref, tailq);
        if (next) {
            TAILQ_REMOVE(&transition->actions, aref, tailq);
            TAILQ_INSERT_AFTER(&transition->actions, next, aref, tailq);
            priv->redraw = true;
        }
    } else if (priv->dx < -10.0) {
        ufsmm_canvas_reset_delta(priv);
        prev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);

        if (prev) {
            TAILQ_REMOVE(&transition->actions, aref, tailq);
            TAILQ_INSERT_BEFORE(prev, aref, tailq);
            priv->redraw = true;
        }
    }
}

void canvas_reorder_entry_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_action_ref *aref = priv->selected_aref;

    struct reorder_aref_op *op = malloc(sizeof(struct reorder_aref_op));

    if (op == NULL) {
        L_ERR("Could not allocate");
        return;
    }

    memset(op, 0, sizeof(*op));
    priv->command_data = (void *) op;
    op->list = &state->entries;
    op->aref = aref;
    op->prev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);
    op->next = TAILQ_NEXT(aref, tailq);
}

void canvas_reorder_entry_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_action_ref *aref = priv->selected_aref;
    struct reorder_aref_op *op = (struct reorder_aref_op *) priv->command_data;

    if ((op->prev != TAILQ_PREV(aref, ufsmm_action_refs, tailq)) ||
        (op->next != TAILQ_NEXT(aref, tailq))) {

        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_reorder_aref(undo_ops, op->list,
                                           op->aref,
                                           op->prev,
                                           op->next);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
}

void canvas_reorder_entry_func(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_action_ref *aref = priv->selected_aref;
    struct ufsmm_action_ref *next, *prev;

    if (priv->dy > 10.0) {
        L_DEBUG("Move down!");
        ufsmm_canvas_reset_delta(priv);
        next = TAILQ_NEXT(aref, tailq);
        if (next) {
            TAILQ_REMOVE(&state->entries, aref, tailq);
            TAILQ_INSERT_AFTER(&state->entries, next, aref, tailq);
            priv->redraw = true;
        }
    } else if (priv->dy < -10.0) {
        L_DEBUG("Move up!");
        ufsmm_canvas_reset_delta(priv);
        prev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);

        if (prev) {
            TAILQ_REMOVE(&state->entries, aref, tailq);
            TAILQ_INSERT_BEFORE(prev, aref, tailq);
            priv->redraw = true;
        }
    }
}

void canvas_reorder_exit_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_action_ref *aref = priv->selected_aref;

    struct reorder_aref_op *op = malloc(sizeof(struct reorder_aref_op));

    if (op == NULL) {
        L_ERR("Could not allocate");
        return;
    }

    memset(op, 0, sizeof(*op));
    priv->command_data = (void *) op;
    op->list = &state->exits;
    op->aref = aref;
    op->prev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);
    op->next = TAILQ_NEXT(aref, tailq);
}

void canvas_reorder_exit_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_action_ref *aref = priv->selected_aref;
    struct reorder_aref_op *op = (struct reorder_aref_op *) priv->command_data;

    if ((op->prev != TAILQ_PREV(aref, ufsmm_action_refs, tailq)) ||
        (op->next != TAILQ_NEXT(aref, tailq))) {

        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_reorder_aref(undo_ops, op->list,
                                           op->aref,
                                           op->prev,
                                           op->next);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
}

void canvas_reorder_exit_func(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_action_ref *aref = priv->selected_aref;
    struct ufsmm_action_ref *next, *prev;

    if (priv->dy > 10.0) {
        ufsmm_canvas_reset_delta(priv);
        next = TAILQ_NEXT(aref, tailq);
        if (next) {
            TAILQ_REMOVE(&state->exits, aref, tailq);
            TAILQ_INSERT_AFTER(&state->exits, next, aref, tailq);
            priv->redraw = true;
        }
    } else if (priv->dy < -10.0) {
        ufsmm_canvas_reset_delta(priv);
        prev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);

        if (prev) {
            TAILQ_REMOVE(&state->exits, aref, tailq);
            TAILQ_INSERT_BEFORE(prev, aref, tailq);
            priv->redraw = true;
        }
    }
}

void canvas_resize_text_block_begin(void *context)
{
}

void canvas_resize_text_block_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_move_coords(undo_ops, &t->text_block_coords);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
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
                t->text_block_coords.w = t->text_block_coords.tw + dx;
            }

            if ((t->text_block_coords.th - dy) <= 30) {
                t->text_block_coords.h = 30;
            } else {
                t->text_block_coords.h = t->text_block_coords.th - dy;
                t->text_block_coords.y = t->text_block_coords.ty + dy;
            }
        }
        break;
        case UFSMM_BOT_RIGHT:
            t->text_block_coords.w = t->text_block_coords.tw + dx;
            t->text_block_coords.h = t->text_block_coords.th + dy;
        break;
        case UFSMM_BOT_LEFT:
            t->text_block_coords.w = t->text_block_coords.tw - dx;
            t->text_block_coords.x = t->text_block_coords.tx + dx;
            t->text_block_coords.h = t->text_block_coords.th + dy;
        break;
        case UFSMM_TOP_LEFT:
            if (t->text_block_coords.w <= 50) {
                t->text_block_coords.w = 50;
            } else {
                t->text_block_coords.w = t->text_block_coords.tw - dx;
                t->text_block_coords.x = t->text_block_coords.tx + dx;
            }

            if ((t->text_block_coords.th - dy) <= 30) {
                t->text_block_coords.h = 30;
            } else {
                t->text_block_coords.h = t->text_block_coords.th - dy;
                t->text_block_coords.y = t->text_block_coords.ty + dy;
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

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_add_region(undo_ops, new_region);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);

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

    if (rc == UFSMM_OK) {
        struct ufsmm_region *r;
        struct ufsmm_state *s;
        struct ufsmm_transition *t;
        struct ufsmm_vertice *v;
        struct ufsmm_action_ref *aref;
        double y_off = 30;
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

        L_DEBUG("Add entry on state %s %i %f", priv->selected_state->name, rc, y_off);
        /* Update possible children */
        TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
            if (r->off_page == false) {
                TAILQ_FOREACH(s, &r->states, tailq) {
                    s->tx = s->x;
                    s->ty = s->y;
                    s->tw = s->w;
                    s->th = s->h;
                    s->tparent_region = s->parent_region;
                    s->y += y_off;
                    ufsmm_undo_resize_state(undo_ops, s);
                    TAILQ_FOREACH(t, &s->transitions, tailq) {
                        TAILQ_FOREACH(v,  &t->vertices, tailq) {
                            v->tx = v->x;
                            v->ty = v->y;
                            v->y += y_off;
                            ufsmm_undo_move_vertice(undo_ops, v);
                        }
                    }
                }
            }
        }

        aref = TAILQ_LAST(&priv->selected_state->entries,
                              ufsmm_action_refs);

        ufsmm_undo_add_aref(undo_ops, &priv->selected_state->entries, aref);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);

        priv->redraw = true;
    }

}

void canvas_add_exit(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    rc = ufsm_add_exit_action_dialog(GTK_WINDOW(priv->root_window),
                                        priv->model,
                                        priv->selected_state);
    if (rc == UFSMM_OK) {
        L_DEBUG("Add exit on state %s %i", priv->selected_state->name, rc);

        struct ufsmm_region *r;
        struct ufsmm_state *s;
        struct ufsmm_transition *t;
        struct ufsmm_vertice *v;
        struct ufsmm_action_ref *aref;
        double y_off = 30;
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

        /* Update possible children */
        TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
            if (r->off_page == false) {
                TAILQ_FOREACH(s, &r->states, tailq) {
                    s->tx = s->x;
                    s->ty = s->y;
                    s->tw = s->w;
                    s->th = s->h;
                    s->tparent_region = s->parent_region;
                    s->y += y_off;
                    ufsmm_undo_resize_state(undo_ops, s);
                    TAILQ_FOREACH(t, &s->transitions, tailq) {
                        TAILQ_FOREACH(v,  &t->vertices, tailq) {
                            v->tx = v->x;
                            v->ty = v->y;
                            v->y += y_off;
                            ufsmm_undo_move_vertice(undo_ops, v);
                        }
                    }
                }
            }
        }

        aref = TAILQ_LAST(&priv->selected_state->exits,
                              ufsmm_action_refs);

        ufsmm_undo_add_aref(undo_ops, &priv->selected_state->exits, aref);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);

        priv->redraw = true;
    }
}

void canvas_edit_state_name(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    const char *old_name = strdup(priv->selected_state->name);

    int rc = ufsm_edit_string_dialog(GTK_WINDOW(priv->root_window),
                                "Edit state name",
                                &priv->selected_state->name);

    if (rc == UFSMM_OK) {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_rename_state(undo_ops, priv->selected_state, old_name);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free((void *) old_name);
}

void canvas_edit_region_name(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    const char *old_name = strdup(priv->selected_region->name);
    int rc;

    rc = ufsm_edit_string_dialog(GTK_WINDOW(priv->root_window), "Edit region name",
                                &priv->selected_region->name);

    if (rc == UFSMM_OK) {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_rename_region(undo_ops, priv->selected_region, old_name);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }
}

void canvas_add_guard(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_guard_ref *new_guard;
    int rc;

    rc = ufsm_add_transition_guard_dialog(GTK_WINDOW(priv->root_window),
                                            priv->model,
                                            priv->selected_transition,
                                            &new_guard);

    if (rc == UFSMM_OK) {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_add_guard(undo_ops, priv->selected_transition, new_guard);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }
}

void canvas_edit_state_entry(void *context)
{
}

void canvas_edit_state_exit(void *context)
{
}

void canvas_delete_region(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    if (priv->selected_region->draw_as_root)
        return;

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    struct ufsmm_region *pr = NULL;
    struct ufsmm_state *s;
    struct ufsmm_region *r, *r2;
    struct ufsmm_transition *t;
    struct ufsmm_stack *stack;

    if (priv->selected_region->parent_state) {
        pr = priv->selected_region->parent_state->parent_region;
    } else {
        pr = priv->model->root;
    }

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, (void *) priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if (ufsmm_region_contains_state(priv->model,
                                                priv->selected_region,
                                                t->dest.state)) {
                    ufsmm_undo_delete_transition(undo_ops, t);
                    TAILQ_REMOVE(&t->source.state->transitions, t, tailq);
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page)
                    continue;
                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    ufsmm_undo_delete_region(undo_ops, priv->selected_region);
    TAILQ_REMOVE(&priv->selected_region->parent_state->regions,
                priv->selected_region, tailq);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    priv->selected_region = pr;
    priv->redraw = true;
    priv->selection = UFSMM_SELECTION_NONE;
}

void canvas_delete_guard(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_guard_ref *g = priv->selected_guard;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_delete_guard(undo_ops, t, g);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    TAILQ_REMOVE(&t->guards, g, tailq);
    priv->redraw = true;
    priv->selection = UFSMM_SELECTION_NONE;
}

void canvas_delete_action(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_delete_aref(undo_ops, &priv->selected_transition->actions,
                                     priv->selected_aref);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    TAILQ_REMOVE(&priv->selected_transition->actions,
                 priv->selected_aref, tailq);
    priv->redraw = true;
    priv->selection = UFSMM_SELECTION_NONE;
}

void canvas_delete_transition(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_delete_transition(undo_ops, t);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    TAILQ_REMOVE(&t->source.state->transitions, t, tailq);
    //ufsmm_state_delete_transition(t);
    priv->selection = UFSMM_SELECTION_NONE;
    priv->redraw = true;
}

void canvas_delete_entry(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_action_ref *ar = priv->selected_aref;
    L_DEBUG("Deleting entry");

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_delete_aref(undo_ops, &s->entries, ar);
    TAILQ_REMOVE(&s->entries, ar, tailq);

    //ufsmm_state_delete_entry(s, ar->id);

    struct ufsmm_region *r;
    struct ufsmm_transition *t;
    struct ufsmm_vertice *v;
    double y_off = -30;

    /* Update possible children */
    TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
        if (r->off_page == false) {
            TAILQ_FOREACH(s, &r->states, tailq) {
                s->tx = s->x;
                s->ty = s->y;
                s->tw = s->w;
                s->th = s->h;
                s->tparent_region = s->parent_region;
                s->y += y_off;
                ufsmm_undo_resize_state(undo_ops, s);
                TAILQ_FOREACH(t, &s->transitions, tailq) {
                    t->text_block_coords.tx = t->text_block_coords.x;
                    t->text_block_coords.ty = t->text_block_coords.y;
                    t->text_block_coords.tw = t->text_block_coords.w;
                    t->text_block_coords.th = t->text_block_coords.h;
                    t->text_block_coords.y += y_off;
                    ufsmm_undo_move_coords(undo_ops, &t->text_block_coords);
                    TAILQ_FOREACH(v,  &t->vertices, tailq) {
                        v->tx = v->x;
                        v->ty = v->y;
                        v->y += y_off;
                        ufsmm_undo_move_vertice(undo_ops, v);
                    }
                }
            }
        }
    }

    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    priv->selection = UFSMM_SELECTION_NONE;
    priv->redraw = true;
}

void canvas_delete_exit(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_action_ref *ar = priv->selected_aref;

    L_DEBUG("Deleting exit");

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_delete_aref(undo_ops, &s->exits, ar);
    TAILQ_REMOVE(&s->exits, ar, tailq);
    //ufsmm_state_delete_exit(s, ar->id);

    struct ufsmm_region *r;
    struct ufsmm_transition *t;
    struct ufsmm_vertice *v;
    double y_off = -30;

    /* Update possible children */
    TAILQ_FOREACH(r, &priv->selected_state->regions, tailq) {
        if (r->off_page == false) {
            TAILQ_FOREACH(s, &r->states, tailq) {
                s->tx = s->x;
                s->ty = s->y;
                s->tw = s->w;
                s->th = s->h;
                s->tparent_region = s->parent_region;
                s->y += y_off;
                ufsmm_undo_resize_state(undo_ops, s);
                TAILQ_FOREACH(t, &s->transitions, tailq) {
                    t->text_block_coords.tx = t->text_block_coords.x;
                    t->text_block_coords.ty = t->text_block_coords.y;
                    t->text_block_coords.tw = t->text_block_coords.w;
                    t->text_block_coords.th = t->text_block_coords.h;
                    t->text_block_coords.y += y_off;
                    ufsmm_undo_move_coords(undo_ops, &t->text_block_coords);
                    TAILQ_FOREACH(v,  &t->vertices, tailq) {
                        v->tx = v->x;
                        v->ty = v->y;
                        v->y += y_off;
                        ufsmm_undo_move_vertice(undo_ops, v);
                    }
                }
            }
        }
    }
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    priv->selection = UFSMM_SELECTION_NONE;
    priv->redraw = true;
}

void canvas_delete_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *state = priv->selected_state;
    struct ufsmm_stack *stack;
    struct ufsmm_state *s;
    struct ufsmm_region *r, *r2;
    struct ufsmm_transition *t;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, (void *) priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if ((t->dest.state == state) ||
                    (ufsmm_state_is_descendant(t->dest.state, state))) {
                    L_DEBUG("Un-linking transition %s->%s",
                            t->source.state->name, t->dest.state->name);
                    ufsmm_undo_delete_transition(undo_ops, t);
                    TAILQ_REMOVE(&t->source.state->transitions, t, tailq);
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page == false) {
                    ufsmm_stack_push(stack, (void *) r2);
                }
            }
        }
    }

    ufsmm_undo_delete_state(undo_ops, state);
    TAILQ_REMOVE(&state->parent_region->states, state, tailq);
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
    ufsmm_stack_free(stack);
    priv->selected_state = NULL;
    priv->selection = UFSMM_SELECTION_NONE;
    priv->redraw = true;
}

struct state_op {
    struct ufsmm_state *state;
    struct ufsmm_region *pr;
    bool commit;
};

void canvas_create_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s", __func__);
    priv->command_data = malloc(sizeof(struct state_op));
    memset(priv->command_data, 0, sizeof(struct state_op));
    struct state_op *op = (struct state_op *) priv->command_data;
    op->state = ufsmm_state_new(UFSMM_STATE_NORMAL);
    op->state->w = 200;
    op->state->h = 100;
    op->state->parent_region = priv->current_region;
    priv->preview_state = op->state;
    ufsmm_state_set_name(op->state, "New state");
}

void canvas_create_state_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct state_op *op = (struct state_op *) priv->command_data;

    if (!op->commit) {
        ufsmm_state_free(op->state);
    } else {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_add_state(undo_ops, op->state);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
    priv->preview_state = NULL;
    priv->redraw = true;
}

void canvas_new_state_set_start(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct state_op *op = (struct state_op *) priv->command_data;

    double ox = priv->current_region->ox;
    double oy = priv->current_region->oy;

    ufsmm_region_get_at_xy(priv->current_region, priv->px, priv->py,
                            &op->pr, NULL);

    op->state->x = ufsmm_canvas_nearest_grid_point(priv->px - ox - 10);
    op->state->y = ufsmm_canvas_nearest_grid_point(priv->py - oy - 20);
    priv->redraw = true;
}

void canvas_new_state_set_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct state_op *op = (struct state_op *) priv->command_data;

    double ox = priv->current_region->ox;
    double oy = priv->current_region->oy;

    ufsmm_region_get_at_xy(priv->current_region, priv->px, priv->py,
                            &op->pr, NULL);

    op->state->w = ufsmm_canvas_nearest_grid_point(priv->px - ox - 10) - op->state->x;
    op->state->h = ufsmm_canvas_nearest_grid_point(priv->py - oy - 20) - op->state->y;

    if (op->state->w < 50)
        op->state->w = 50.0;

    if (op->state->h < 50)
        op->state->h = 50.0;

    priv->redraw = true;
}

void canvas_create_new_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct state_op *op = (struct state_op *) priv->command_data;
    struct ufsmm_region *cr = priv->current_region;
    double x, y, w, h;
    op->commit = true;
    ufsmm_region_append_state(op->pr, op->state);
    priv->redraw = true;
    L_DEBUG("Added new state to region '%s' cr='%s'", op->pr->name, cr->name);
}


void canvas_toggle_region_offpage(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;
    struct ufsmm_vertice *v;
    double y_off = 0;
    double x_off = 0;

    if (priv->selected_region->off_page) {
        x_off = priv->selected_state->x;
        y_off = priv->selected_state->y;
    } else {
        x_off = -priv->selected_state->x;
        y_off = -priv->selected_state->y;
    }

    /* Update possible children */

    static struct ufsmm_stack *stack;
    struct ufsmm_region *r2;
    /* Update possible children */

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, priv->selected_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            s->y += y_off;
            s->x += x_off;
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page == false) {
                    ufsmm_stack_push(stack, r2);
                }
            }

            TAILQ_FOREACH(t, &s->transitions, tailq) {
                t->text_block_coords.x += x_off;
                t->text_block_coords.y += y_off;
                TAILQ_FOREACH(v,  &t->vertices, tailq) {
                    v->y += y_off;
                    v->x += x_off;
                }
            }
        }
    }

    priv->selected_region->off_page = !priv->selected_region->off_page;
    priv->redraw = true;
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
    struct ufsmm_action_ref *aref;
    int rc;

    rc = ufsm_add_transition_action_dialog(GTK_WINDOW(priv->root_window),
                                            priv->model,
                                            priv->selected_transition);

    if (rc == UFSMM_OK) {
        aref = TAILQ_LAST(&priv->selected_transition->actions,
                              ufsmm_action_refs);

        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_add_aref(undo_ops, &priv->selected_transition->actions, aref);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }
}

/* ADD: Transition */

struct transition_op {
    struct ufsmm_transition *t;
    bool commit;
};

void canvas_create_transition_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    priv->command_data = malloc(sizeof(struct transition_op));
    memset(priv->command_data, 0, sizeof(struct transition_op));

    struct transition_op *op = (struct transition_op *) priv->command_data;
    ufsmm_transition_new(&op->t);
    priv->preview_transition = NULL;
}

void canvas_create_transition_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct transition_op *op = (struct transition_op *) priv->command_data;

    priv->preview_transition = NULL;

    if (op->commit == false) {
        L_DEBUG("Freeing transition");
        ufsmm_transition_free_one(op->t);

        L_DEBUG("Freeing transition done");
    } else {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_add_transition(undo_ops, op->t);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
    priv->redraw = true;
}

void canvas_create_transition_start(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct transition_op *op = (struct transition_op *) priv->command_data;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_state *source_state;

    L_DEBUG("Looking for source state at <%f, %f>", priv->px,
                                                    priv->py);
    rc = ufsmm_state_get_at_xy(priv->current_region,
                                    priv->px,
                                    priv->py,
                                    &source_state, NULL);

    if (rc == UFSMM_OK) {
        L_DEBUG("Found source state: %s", source_state->name);
        op->t->source.state = source_state;
        ufsmm_state_get_closest_side(source_state,
                                    priv->px, priv->py,
                                    priv->current_region,
                                    &op->t->source.side,
                                    &op->t->source.offset);
        op->t->dest.state = NULL;

        transition_calc_begin_end_point(op->t->source.state,
                             op->t->source.side,
                             op->t->source.offset,
                             &op->t->text_block_coords.x,
                             &op->t->text_block_coords.y);

        priv->preview_transition = op->t;
    }

    priv->redraw = true;
}

void canvas_transition_update_preview(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct transition_op *op = (struct transition_op *) priv->command_data;

    priv->redraw = true;
}

void canvas_create_transition(void *context)
{
    int rc;
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct transition_op *op = (struct transition_op *) priv->command_data;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_state *dest_state;
    double dest_offset;
    enum ufsmm_side source_side, dest_side;

    L_DEBUG("Looking for dest state at <%f, %f>", priv->px,
                                                  priv->py);
    rc = ufsmm_state_get_at_xy(priv->current_region,
                                    priv->px,
                                    priv->py,
                                    &dest_state, NULL);

    if (rc == UFSMM_OK) {
        L_DEBUG("Found destination state: %s", dest_state->name);

        ufsmm_state_get_closest_side(dest_state,
                                     priv->px, priv->py,
                                     priv->current_region,
                                    &dest_side,
                                    &dest_offset);
        L_DEBUG("Creating transition %s --> %s", op->t->source.state->name,
                                                 dest_state->name);
        op->t->dest.side = dest_side;
        op->t->dest.offset = dest_offset;

        op->t->text_block_coords.w = 100;
        op->t->text_block_coords.h = 30;

        ufsmm_state_add_transition(op->t->source.state,
                                   dest_state,
                                   op->t);
        op->commit = true;
    }

    priv->redraw = true;
}

void canvas_transition_vdel_last(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct transition_op *op = (struct transition_op *) priv->command_data;
    struct ufsmm_vertice *v = TAILQ_LAST(&op->t->vertices, ufsmm_vertices);
    L_DEBUG("%s", __func__);
    if (v) {
        TAILQ_REMOVE(&op->t->vertices, v, tailq);
    }
}

void canvas_add_transition_vertice(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct transition_op *op = (struct transition_op *) priv->command_data;
    struct ufsmm_vertice *v;

    v = malloc(sizeof(*v));
    memset(v, 0, sizeof(*v));

    v->x = ufsmm_canvas_nearest_grid_point(priv->px - priv->current_region->ox);
    v->y = ufsmm_canvas_nearest_grid_point(priv->py - priv->current_region->oy);

    TAILQ_INSERT_TAIL(&op->t->vertices, v, tailq);
    L_DEBUG("Add vertice at <%f, %f>", v->x, v->y);
}

struct sstate_op {
    struct ufsmm_state *state;
    struct ufsmm_region *pr;
    bool commit;
};

static void create_simple_state_begin(void *context, enum ufsmm_state_kind kind,
                                        const char *name)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s", __func__);
    priv->command_data = malloc(sizeof(struct sstate_op));
    memset(priv->command_data, 0, sizeof(struct sstate_op));
    struct sstate_op *op = (struct sstate_op *) priv->command_data;
    op->state = ufsmm_state_new(kind);
    op->state->w = 20;
    op->state->h = 20;
    op->state->parent_region = priv->current_region;
    priv->preview_state = op->state;
    ufsmm_state_set_name(op->state, name);
}

static void create_simple_state_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct sstate_op *op = (struct sstate_op *) priv->command_data;

    if (!op->commit) {
        ufsmm_state_free(op->state);
    } else {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_add_state(undo_ops, op->state);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(op);
    priv->preview_state = NULL;
    priv->redraw = true;
}

static void add_simple_state_to_region(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct sstate_op *op = (struct sstate_op *) priv->command_data;
    struct ufsmm_region *cr = priv->current_region;
    double x, y, w, h;

    op->commit = true;
    ufsmm_region_append_state(op->pr, op->state);
    priv->redraw = true;
    L_DEBUG("Added sstate to region '%s'", op->pr->name);
}

static void simple_state_update_preview(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct sstate_op *op = (struct sstate_op *) priv->command_data;

    double ox = priv->current_region->ox;
    double oy = priv->current_region->oy;

    ufsmm_region_get_at_xy(priv->current_region, priv->px, priv->py,
                            &op->pr, NULL);

    op->state->x = ufsmm_canvas_nearest_grid_point(priv->px - ox - 10);
    op->state->y = ufsmm_canvas_nearest_grid_point(priv->py - oy - 20);
    priv->redraw = true;
}

/* ADD: Terminate */

void canvas_create_terminate_begin(void *context)
{
    create_simple_state_begin(context, UFSMM_STATE_TERMINATE, "Terminate");
}

void canvas_create_terminate_end(void *context)
{
    create_simple_state_end(context);
}

void canvas_add_terminate_to_region(void *context)
{
    add_simple_state_to_region(context);
}

void canvas_terminate_update_preview(void *context)
{
    simple_state_update_preview(context);
}

/* ADD: History */

void canvas_create_history_begin(void *context)
{
    create_simple_state_begin(context, UFSMM_STATE_SHALLOW_HISTORY, "Shallow history");
}

void canvas_create_history_end(void *context)
{
    create_simple_state_end(context);
}

void canvas_history_update_preview(void *context)
{
    simple_state_update_preview(context);
}

void canvas_add_history_to_region(void *context)
{
    add_simple_state_to_region(context);
}

/* ADD: Deep history */

void canvas_create_dhistory_begin(void *context)
{
    create_simple_state_begin(context, UFSMM_STATE_DEEP_HISTORY, "Deep history");
}

void canvas_create_dhistory_end(void *context)
{
    create_simple_state_end(context);
}

void canvas_dhistory_update_preview(void *context)
{
    simple_state_update_preview(context);
}

void canvas_add_dhistory_to_region(void *context)
{
    add_simple_state_to_region(context);
}

/* ADD: Init */

void canvas_create_init_begin(void *context)
{
    create_simple_state_begin(context, UFSMM_STATE_INIT, "Init");
}

void canvas_create_init_end(void *context)
{
    create_simple_state_end(context);
}

void canvas_update_init_preview(void *context)
{
    simple_state_update_preview(context);
}

void canvas_add_init_to_region(void *context)
{
    add_simple_state_to_region(context);
}

/* ADD: Final */

void canvas_create_final_begin(void *context)
{
    create_simple_state_begin(context, UFSMM_STATE_FINAL, "Final");
}

void canvas_create_final_end(void *context)
{
    create_simple_state_end(context);
}

void canvas_update_final_preview(void *context)
{
    simple_state_update_preview(context);
}

void canvas_add_final_to_region(void *context)
{
    add_simple_state_to_region(context);
}

struct fork_join_op {
    struct ufsmm_state *state;
    struct ufsmm_region *pr;
    bool commit;
};

static void create_fork_join_begin(void *context, bool fork)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s", __func__);
    priv->command_data = malloc(sizeof(struct fork_join_op));
    memset(priv->command_data, 0, sizeof(struct fork_join_op));
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;
    if (fork)
        op->state = ufsmm_state_new(UFSMM_STATE_FORK);
    else
        op->state = ufsmm_state_new(UFSMM_STATE_JOIN);
    op->state->parent_region = priv->current_region;
    op->state->orientation = UFSMM_ORIENTATION_VERTICAL;
    op->state->w = 10;
    op->state->h = 200;
    priv->preview_state = op->state;

    if (fork)
        ufsmm_state_set_name(op->state, "Fork");
    else
        ufsmm_state_set_name(op->state, "Join");
}

static void create_fork_join_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;
    L_DEBUG("%s", __func__);

    priv->preview_state = NULL;

    if (op->commit == false) {
        ufsmm_state_free(op->state);
    } else {
        struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
        ufsmm_undo_add_state(undo_ops, op->state);
        ufsmm_undo_commit_ops(priv->undo, undo_ops);
    }

    free(priv->command_data);
    priv->redraw = true;
}

static void create_fork_join_start(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;
    struct ufsmm_region *cr = priv->current_region;
    double x, y, w, h;

    op->state->parent_region = op->pr;
    priv->redraw = true;
    priv->sx = priv->px;
    priv->sy = priv->py;
}

static void update_fork_join_preview(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;
    L_DEBUG("%s", __func__);

    if (op->state->orientation == UFSMM_ORIENTATION_HORIZONTAL) {
        op->state->w = ufsmm_canvas_nearest_grid_point(priv->dx);
        if (op->state->w < 50)
            op->state->w = 50;
    } else {
        op->state->h = ufsmm_canvas_nearest_grid_point(priv->dy);
        if (op->state->h < 50)
            op->state->h = 50;
    }
    priv->redraw = true;
}

static void add_fork_join_to_region(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;
    L_DEBUG("%s", __func__);

    op->state->h = ufsmm_canvas_nearest_grid_point(op->state->h);
    op->state->w = ufsmm_canvas_nearest_grid_point(op->state->w);

    ufsmm_region_append_state(op->pr, op->state);
    priv->redraw = true;
    op->commit = true;
}

static void toggle_fork_join_orientation(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;

    if (op->state->orientation == UFSMM_ORIENTATION_VERTICAL) {
        op->state->orientation = UFSMM_ORIENTATION_HORIZONTAL;
        op->state->w = 200;
        op->state->h = 10;
    } else {
        op->state->orientation = UFSMM_ORIENTATION_VERTICAL;
        op->state->w = 10;
        op->state->h = 200;
    }

    priv->redraw = true;
}

static void update_fork_join_start(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct fork_join_op *op = (struct fork_join_op *) priv->command_data;

    double ox = priv->current_region->ox;
    double oy = priv->current_region->oy;

    ufsmm_region_get_at_xy(priv->current_region, priv->px, priv->py,
                            &op->pr, NULL);

    op->state->x = ufsmm_canvas_nearest_grid_point(priv->px - ox - 10);
    op->state->y = ufsmm_canvas_nearest_grid_point(priv->py - oy - 20);
    priv->redraw = true;
}

/* ADD: Fork */

void canvas_create_fork_begin(void *context)
{
    create_fork_join_begin(context, true);
}

void canvas_create_fork_end(void *context)
{
    create_fork_join_end(context);
}

void canvas_create_fork_start(void *context)
{
    create_fork_join_start(context);
}

void canvas_update_fork_preview(void *context)
{
    update_fork_join_preview(context);
}

void canvas_add_fork_to_region(void *context)
{
    add_fork_join_to_region(context);
}

void canvas_toggle_fork_orientation(void *context)
{
    toggle_fork_join_orientation(context);
}

void canvas_update_fork_start(void *context)
{
    update_fork_join_start(context);
}

/* ADD: Join */

void canvas_create_join_begin(void *context)
{
    create_fork_join_begin(context, false);
}

void canvas_create_join_end(void *context)
{
    create_fork_join_end(context);
}

void canvas_create_join_start(void *context)
{
    create_fork_join_start(context);
}

void canvas_update_join_preview(void *context)
{
    update_fork_join_preview(context);
}

void canvas_add_join_to_region(void *context)
{
    add_fork_join_to_region(context);
}

void canvas_toggle_join_orientation(void *context)
{
    toggle_fork_join_orientation(context);
}

void canvas_update_join_start(void *context)
{
    update_fork_join_start(context);
}

void canvas_delete_transition_tvertice(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    TAILQ_REMOVE(&priv->selected_transition->vertices,
                 priv->selected_transition_vertice_data, tailq);

    priv->selected_transition_vertice_data = NULL;
    priv->selection = UFSMM_SELECTION_NONE;
    priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_NONE;
    priv->redraw = true;
}

int canvas_transition_tvertice_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selected_transition_vertice == UFSMM_TRANSITION_VERTICE);
}

void canvas_add_vertice(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_vertice *v, *v_new, *vn;
    double x, y, w, h;
    double sx, sy, ex, ey;
    double min_dist = 10000;

    transition_calc_begin_end_point(t->source.state,
                                    t->source.side,
                                    t->source.offset,
                                    &sx, &sy);

    transition_calc_begin_end_point(t->dest.state,
                                    t->dest.side,
                                    t->dest.offset,
                                    &ex, &ey);

    v_new = malloc(sizeof(*v_new));
    memset(v_new, 0, sizeof(*v_new));

    v_new->x = ufsmm_canvas_nearest_grid_point(priv->px - priv->current_region->ox);
    v_new->y = ufsmm_canvas_nearest_grid_point(priv->py - priv->current_region->oy);

    /* TODO: Locate where the new vertice should be inserted */
    vn = TAILQ_FIRST(&t->vertices);

    if (vn) {
        TAILQ_FOREACH(v, &t->vertices, tailq) {
            double d = distance_point_to_seg(priv->px - priv->current_region->ox,
                                             priv->py - priv->current_region->oy,
                                             sx, sy,
                                             v->x, v->y);
            if (d < min_dist) {
                vn = v;
                min_dist = d;
            }
            sx = v->x;
            sy = v->y;
        }

        v = TAILQ_LAST(&t->vertices, ufsmm_vertices);
        /* Check distance between start and first vertice */
        double d = distance_point_to_seg(priv->px - priv->current_region->ox,
                                         priv->py - priv->current_region->oy,
                                         ex, ey,
                                         v->x, v->y);
        if (d < min_dist) {
            TAILQ_INSERT_AFTER(&t->vertices, v, v_new, tailq);
        } else {
            TAILQ_INSERT_BEFORE(vn, v_new, tailq);
        }
    } else {
        /* Had no vertices */
        TAILQ_INSERT_TAIL(&t->vertices, v_new, tailq);
    }

    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    ufsmm_undo_add_vertice(undo_ops, t, v_new,
                            TAILQ_PREV(v_new, ufsmm_vertices, tailq),
                            TAILQ_NEXT(v_new, tailq));
    ufsmm_undo_commit_ops(priv->undo, undo_ops);

    priv->redraw = true;
}

struct mselect_op {
    double sx, sy;
    double ex, ey;
};

void canvas_mselect_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    priv->command_data = malloc(sizeof(struct mselect_op));
    memset(priv->command_data, 0, sizeof(struct mselect_op));

    priv->selected_region->selected = false;

    struct mselect_op *op = (struct mselect_op *) priv->command_data;
    op->sx = priv->px;
    op->sy = priv->py;
}

void canvas_mselect_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct mselect_op *op = (struct mselect_op *) priv->command_data;
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_state *selected_state;
    struct ufsmm_region *selected_region;
    struct ufsmm_coords *selected_text_block;
    enum ufsmm_resize_selector selected_text_block_corner;
    struct ufsmm_action_ref *selected_action_ref = NULL;
    double ox, oy;

    op->sx -= priv->current_region->ox;
    op->sy -= priv->current_region->oy;
    op->ex = priv->px - priv->current_region->ox;
    op->ey = priv->py - priv->current_region->oy;

    ox = priv->current_region->ox;
    oy = priv->current_region->oy;

    priv->selection = UFSMM_SELECTION_NONE;
    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    /* Check states and regions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        if (r->off_page && !r->draw_as_root)
            continue;

        TAILQ_FOREACH(s, &r->states, tailq) {
            if ((s->x > op->sx) &&
                (s->y > op->sy) &&
                ((s->x + s->w) < op->ex) &&
                ((s->y + s->h) < op->ey)) {
                L_DEBUG("State '%s' selected", s->name);
                s->selected = true;
                priv->selection_count++;
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    /* Check transitions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        if (r->off_page && !r->draw_as_root)
            continue;

        TAILQ_FOREACH(s, &r->states, tailq) {
            struct ufsmm_transition *t;
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                struct ufsmm_vertice *v;
                double tsx, tsy, tex, tey;

                transition_calc_begin_end_point(s,
                                                t->source.side,
                                                t->source.offset,
                                                &tsx, &tsy);
                transition_calc_begin_end_point(t->dest.state,
                                                t->dest.side,
                                                t->dest.offset,
                                                &tex, &tey);

                if (point_in_box3(tsx, tsy, op->sx, op->sy, op->ex, op->ey) &&
                    point_in_box3(tex, tey, op->sx, op->sy, op->ex, op->ey)) {
                    t->selected = true;
                    priv->selection_count++;
                    continue;
                }

            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);
    free(op);
    ufsmm_canvas_set_selection(false, 0, 0, 0, 0);
    priv->redraw = true;
}

void canvas_update_mselect(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct mselect_op *op = (struct mselect_op *) priv->command_data;
    double ox = priv->current_region->ox;
    double oy = priv->current_region->oy;
    ufsmm_canvas_set_selection(true, op->sx - ox, op->sy - oy,
                                     priv->px - ox, priv->py - oy);
    priv->redraw = true;
}

void canvas_copy_selection(void *context)
{
    L_DEBUG("%s", __func__);
}

struct mselect_state {
    struct ufsmm_state *state;
    TAILQ_ENTRY(mselect_state) tailq;
};

TAILQ_HEAD(mselect_states, mselect_state);

struct mselect_move_op {
    struct mselect_states states;
    struct transition_refs transitions;
};

static void mselect_add_transition(struct transition_refs *list,
                                   struct ufsmm_transition *t)
{
    struct transition_ref *mt = malloc(sizeof(struct transition_ref));
    struct ufsmm_vertice *v;
    memset(mt, 0, sizeof(*mt));
    mt->transition = t;
    TAILQ_INSERT_TAIL(list, mt, tailq);

    t->text_block_coords.tx = t->text_block_coords.x;
    t->text_block_coords.ty = t->text_block_coords.y;
    t->text_block_coords.tw = t->text_block_coords.w;
    t->text_block_coords.th = t->text_block_coords.h;
    TAILQ_FOREACH(v,  &t->vertices, tailq) {
        v->tx = v->x;
        v->ty = v->y;
    }
}

static void mselect_add_state(struct mselect_states *list,
                              struct transition_refs *tlist,
                              struct ufsmm_state *state)
{
    struct mselect_state *ms = malloc(sizeof(struct mselect_state));
    struct ufsmm_region *r;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;

    memset(ms, 0, sizeof(*ms));
    ms->state = state;
    state->tx = state->x;
    state->ty = state->y;
    state->tw = state->w;
    state->th = state->h;
    state->tparent_region = state->parent_region;
    TAILQ_INSERT_TAIL(list, ms, tailq);

    /* Add possible children of this state */
    TAILQ_FOREACH(r, &state->regions, tailq) {
        if (r->off_page == false) {
            TAILQ_FOREACH(s, &r->states, tailq) {
                mselect_add_state(list, tlist, s);
                TAILQ_FOREACH(t, &s->transitions, tailq) {
                    if ((ufsmm_state_is_descendant(t->source.state, s)) &&
                        (ufsmm_state_is_descendant(t->dest.state, s))) {
                        mselect_add_transition(tlist, t);
                    }
                }
            }
        }
    }
}

void canvas_mselect_move_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s, *s2;
    struct ufsmm_transition *t;
    struct mselect_move_op *op = malloc(sizeof(struct mselect_move_op));

    memset(op, 0, sizeof(*op));
    priv->command_data = (void *) op;

    TAILQ_INIT(&op->states);
    TAILQ_INIT(&op->transitions);

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    /* Check states */
    ufsmm_stack_push(stack, cr);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        if (r->off_page && !r->draw_as_root)
            continue;

        TAILQ_FOREACH(s, &r->states, tailq) {
            if (s->selected) {
                if (s->parent_region == cr) {
                    L_DEBUG("Move %s", s->name); /* Root state that should be moved */
                    mselect_add_state(&op->states, &op->transitions, s);
                } else {
                    for (r2 = s->parent_region; r2->parent_state; r2 = r2->parent_state->parent_region) {
                        if (r2->off_page && !r2->draw_as_root)
                            break;
                        if (r2 == cr)
                            break;
                        if ((r2->parent_state->selected == false)) {
                            L_DEBUG("Move %s", s->name); /* Root state that should be moved */
                            mselect_add_state(&op->states, &op->transitions, s);
                            break;
                        }
                    }
                }

                TAILQ_FOREACH(t, &s->transitions, tailq) {
                    /* Source state is implicitly selected here.
                     *
                     * The transition should be included in the move operation
                     *  if:
                     *
                     * The actual transition is selected and
                     * if the destination state _or_ one of its possible
                     * parents up until the current region is selected.
                     * */

                    if (t->selected) {

                        L_DEBUG("transition %s->%s is selected",
                            t->source.state->name, t->dest.state->name);
                        s2 = t->dest.state;

                        for (s2 = t->dest.state; s2; s2 = s2->parent_region->parent_state) {
                            if (s2->selected) {
                                L_DEBUG("Move transition %s->%s",
                                    t->source.state->name, t->dest.state->name);
                                mselect_add_transition(&op->transitions, t);
                            }
                            if (s2->parent_region == priv->current_region)
                                break;
                        }
                    } else if (t->dest.state == s) {
                        /* Self transition */
                        mselect_add_transition(&op->transitions, t);
                    }
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);
}

void canvas_toggle_theme(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    if (priv->theme == UFSMM_COLOR_THEME_LIGHT)
        priv->theme = UFSMM_COLOR_THEME_DARK;
    else
        priv->theme = UFSMM_COLOR_THEME_LIGHT;

   priv->redraw = true;
}

void canvas_mselect_move_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();
    struct mselect_move_op *op = (struct mselect_move_op *) priv->command_data;
    struct mselect_state *ms;
    struct ufsmm_vertice *v;
    struct transition_ref *mt;
    struct ufsmm_region *r;
    int rc;

    /* Clean-up */

    while (ms = TAILQ_FIRST(&op->states)) {
        TAILQ_REMOVE(&op->states, ms, tailq);
        struct ufsmm_state *s = ms->state;
        L_DEBUG("Moved state '%s'", s->name);
        /* Check if state should have a new parent region */
        rc = ufsmm_region_get_at_xy(priv->current_region,
                                    s->x + s->w/2 + priv->current_region->ox,
                                    s->y + s->h/2 + priv->current_region->oy,
                                    &r, NULL);

        if (rc == UFSMM_OK) {
            if (r != s->parent_region) {
                L_DEBUG("State '%s' new pr = '%s'", s->name, r->name);
                ufsmm_state_move_to_region(priv->model, s, r);
            }
        }
        ufsmm_undo_resize_state(undo_ops, s);
        free(ms);
    }

    while (mt = TAILQ_FIRST(&op->transitions)) {
        TAILQ_REMOVE(&op->transitions, mt, tailq);
        L_DEBUG("Moved transition '%s->%s'", mt->transition->source.state->name,
                                             mt->transition->dest.state->name);
        ufsmm_undo_move_coords(undo_ops, &mt->transition->text_block_coords);
        TAILQ_FOREACH(v,  &mt->transition->vertices, tailq) {
            ufsmm_undo_move_vertice(undo_ops, v);
        }
        free(mt);
    }

    free(op);
    priv->command_data = NULL;
    ufsmm_undo_commit_ops(priv->undo, undo_ops);
}

void canvas_mselect_move(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct mselect_move_op *op = (struct mselect_move_op *) priv->command_data;
    struct mselect_state *ms;
    struct transition_ref *mt;
    struct ufsmm_vertice *v;

    TAILQ_FOREACH(ms, &op->states, tailq) {
        ms->state->x = ufsmm_canvas_nearest_grid_point(ms->state->tx + priv->dx);
        ms->state->y = ufsmm_canvas_nearest_grid_point(ms->state->ty + priv->dy);
    }

    TAILQ_FOREACH(mt, &op->transitions, tailq) {
        struct ufsmm_transition *t = mt->transition;

        t->text_block_coords.x = \
              ufsmm_canvas_nearest_grid_point(t->text_block_coords.tx + priv->dx);
        t->text_block_coords.y = \
              ufsmm_canvas_nearest_grid_point(t->text_block_coords.ty + priv->dy);

        TAILQ_FOREACH(v,  &t->vertices, tailq) {
            v->x = ufsmm_canvas_nearest_grid_point(v->tx + priv->dx);
            v->y = ufsmm_canvas_nearest_grid_point(v->ty + priv->dy);
        }
    }

    priv->redraw = true;
}

void canvas_undo(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s", __func__);
    ufsmm_undo(priv->undo);
    priv->redraw = true;
}

void canvas_redo(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    L_DEBUG("%s", __func__);
    ufsmm_redo(priv->undo);
    priv->redraw = true;
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
        canvas_machine_process(&priv->machine, eKey_ctrl_down);
    } else if (event->keyval == GDK_KEY_a) {
        canvas_machine_process(&priv->machine, eKey_a_down);
    } else if (event->keyval == GDK_KEY_c) {
        canvas_machine_process(&priv->machine, eKey_c_down);
    } else if (event->keyval == GDK_KEY_n) {
        canvas_machine_process(&priv->machine, eKey_n_down);
    } else if (event->keyval == GDK_KEY_O) {
        canvas_machine_process(&priv->machine, eKey_O_down);
    } else if (event->keyval == GDK_KEY_r) {
        canvas_machine_process(&priv->machine, eKey_r_down);
    } else if (event->keyval == GDK_KEY_v) {
        canvas_machine_process(&priv->machine, eKey_v_down);
    } else if (event->keyval == GDK_KEY_t) {
        canvas_machine_process(&priv->machine, eKey_t_down);
    } else if (event->keyval == GDK_KEY_T) {
        canvas_machine_process(&priv->machine, eKey_T_down);
    } else if (event->keyval == GDK_KEY_h) {
        canvas_machine_process(&priv->machine, eKey_h_down);
    } else if (event->keyval == GDK_KEY_H) {
        canvas_machine_process(&priv->machine, eKey_H_down);
    } else if (event->keyval == GDK_KEY_i) {
        canvas_machine_process(&priv->machine, eKey_i_down);
    } else if (event->keyval == GDK_KEY_j) {
        canvas_machine_process(&priv->machine, eKey_j_down);
    } else if (event->keyval == GDK_KEY_f) {
        canvas_machine_process(&priv->machine, eKey_f_down);
    } else if (event->keyval == GDK_KEY_F) {
        canvas_machine_process(&priv->machine, eKey_F_down);
    } else if (event->keyval == GDK_KEY_g) {
        canvas_machine_process(&priv->machine, eKey_g_down);
    } else if (event->keyval == GDK_KEY_e) {
        canvas_machine_process(&priv->machine, eKey_e_down);
    } else if (event->keyval == GDK_KEY_Escape) {
        canvas_machine_process(&priv->machine, eKey_esc_down);
    } else if (event->keyval == GDK_KEY_x) {
        canvas_machine_process(&priv->machine, eKey_x_down);
    } else if (event->keyval == GDK_KEY_Delete) {
        canvas_machine_process(&priv->machine, eKey_delete_down);
    } else if (event->keyval == GDK_KEY_BackSpace) {
        canvas_machine_process(&priv->machine, eKey_backspace_down);
    } else if (event->keyval == GDK_KEY_s) {
        canvas_machine_process(&priv->machine, eKey_s_down);
    } else if (event->keyval == GDK_KEY_z) {
        canvas_machine_process(&priv->machine, eKey_z_down);
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
        canvas_machine_process(&priv->machine, eKey_ctrl_up);
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
        ufsm_process(&priv->machine.machine, eRMBDown);
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
        ufsm_process(&priv->machine.machine, eRMBUp);
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

static void destroy_event_cb(GtkWidget *widget)
{
    struct ufsmm_canvas *priv =
                    g_object_get_data(G_OBJECT(widget), "canvas private");
    L_DEBUG("Freeing canvas %p", priv);

    ufsmm_undo_free(priv->undo);
    free(priv);
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

    g_signal_connect (G_OBJECT(widget), "destroy",
                    G_CALLBACK (destroy_event_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "draw", G_CALLBACK(draw_cb), NULL);

    gtk_widget_set_can_focus(widget, TRUE);
    gtk_widget_set_focus_on_click(widget, TRUE);
    gtk_widget_grab_focus(widget);

    return widget;
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

    struct ufsmm_undo_context *undo = ufsmm_undo_init(model);

    if (undo == NULL)
        return -1;

    priv->undo = undo;

    return 0;
}
