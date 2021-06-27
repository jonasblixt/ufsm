#include <math.h>
#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

/* Guard function prototypes */

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

void canvas_resize_state_end(void *context)
{
}

void canvas_resize_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    s->tx = s->x;
    s->ty = s->y;
    s->tw = s->w;
    s->th = s->h;
}

void canvas_resize_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->current_region;

    double dy = priv->dy;
    double dx = priv->dx;
    struct ufsmm_state *selected_state = priv->selected_state;

    priv->redraw = true;

    if (selected_state->kind == UFSMM_STATE_NORMAL) {
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
    /*return (priv->selection == UFSMM_SELECTION_TRANSITION) &&
            (priv->selected_transition_vertice != UFSMM_TRANSITION_VERTICE);*/
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

    transition_calc_begin_end_point(priv,
                                    t->source.state,
                                    t->source.side,
                                    t->source.offset,
                                    &tsx, &tsy);
    transition_calc_begin_end_point(priv,
                                    t->dest.state,
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
/*
    ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                       &x, &y, &w, &h);
*/
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

int canvas_transition_dvertice_selected(void *context)
{
    return false;
}

int canvas_mselect_active(void *context)
{
    return 0;
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
                                                        x - 3, y - 3, w + 3, h + 10)) {
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
                transition_calc_begin_end_point(priv,
                                                s,
                                                t->source.side,
                                                t->source.offset,
                                                &tsx, &tsy);
                transition_calc_begin_end_point(priv, t->dest.state,
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

