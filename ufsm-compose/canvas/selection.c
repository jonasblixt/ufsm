#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

/* Guard function prototypes */

bool canvas_state_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_STATE);
}

bool canvas_state_resize_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selected_corner != UFSMM_NO_SELECTION);
}

bool canvas_region_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_REGION);
}

void canvas_resize_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    priv->tx = s->x;
    priv->ty = s->y;
    priv->tw = s->w;
    priv->th = s->h;
}

void canvas_resize_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->current_region;

    double dy = priv->dy;
    double dx = priv->dx;
    struct ufsmm_state *selected_state = priv->selected_state;

    priv->redraw = true;

    switch (priv->selected_corner) {
        case UFSMM_TOP_MIDDLE:
            selected_state->h = priv->th - dy;
            selected_state->y = priv->ty + dy;
        break;
        case UFSMM_BOT_MIDDLE:
            selected_state->h = priv->th + dy;
        break;
        case UFSMM_TOP_RIGHT:
            selected_state->h = priv->th - dy;
            selected_state->w = priv->tw + dx;
            selected_state->y = priv->ty + dy;
        break;
        case UFSMM_RIGHT_MIDDLE:
            selected_state->w = priv->tw + dx;
        break;
        case UFSMM_LEFT_MIDDLE:
            selected_state->w = priv->tw - dx;
            selected_state->x = priv->tx + dx;
        break;
        case UFSMM_BOT_RIGHT:
            selected_state->w = priv->tw + dx;
            selected_state->h = priv->th + dy;
        break;
        case UFSMM_BOT_LEFT:
            selected_state->w = priv->tw - dx;
            selected_state->x = priv->tx + dx;
            selected_state->h = priv->th + dy;
        break;
        case UFSMM_TOP_LEFT:
            selected_state->w = priv->tw - dx;
            selected_state->x = priv->tx + dx;
            selected_state->h = priv->th - dy;
            selected_state->y = priv->ty + dy;
        break;
    }

    if (selected_state->w < 50)
        selected_state->w = 50;

    if (selected_state->h < 50)
        selected_state->h = 50;

    selected_state->x = ufsmm_canvas_nearest_grid_point(selected_state->x);
    selected_state->y = ufsmm_canvas_nearest_grid_point(selected_state->y);
    selected_state->w = ufsmm_canvas_nearest_grid_point(selected_state->w);
    selected_state->h = ufsmm_canvas_nearest_grid_point(selected_state->h);
}

bool canvas_region_resize_selected(void *context)
{
    return false;
}

bool canvas_state_entry_selected(void *context)
{
    return false;
}

bool canvas_transition_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    return (priv->selection == UFSMM_SELECTION_TRANSITION);
}

bool canvas_transition_vertice_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    struct ufsmm_region *r = priv->current_region;
    double vsx, vsy, vex, vey;
    double tsx, tsy, tex, tey;
    double ox = r->ox;
    double oy = r->oy;
    double rx, ry, rw, rh;

    priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_NONE;

    transition_calc_begin_end_point(t->source.state,
                                    t->source.side,
                                    t->source.offset,
                                    &tsx, &tsy);
    transition_calc_begin_end_point(t->dest.state,
                                    t->dest.side,
                                    t->dest.offset,
                                    &tex, &tey);

    ufsmm_get_region_absolute_coords(t->source.state->parent_region, &rx, &ry, &rw, &rh);

    vex = tex + ox;
    vey = tey + oy;

    vsx = tsx + ox;
    vsy = tsy + oy;

    if (point_in_box(priv->px, priv->py, vsx, vsy, 10, 10)) {
        L_DEBUG("Start vertice selected");
        priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_START;
        priv->tx = t->source.offset;
    }

    for (struct ufsmm_vertice *v = t->vertices; v; v = v->next) {
        if (point_in_box(priv->px, priv->py, v->x + ox + rx, v->y + oy + ry, 10, 10)) {
            L_DEBUG("Vertice selected");
            priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE;
            priv->selected_transition_vertice_data = v;
            priv->tx = v->x;
            priv->ty = v->y;
        }
    }

    if (point_in_box(priv->px, priv->py, vex, vey, 10, 10)) {
        priv->selected_transition_vertice = UFSMM_TRANSITION_VERTICE_END;
        L_DEBUG("End vertice selected");
        priv->tx = t->dest.offset;
    }

    return (priv->selected_transition_vertice != UFSMM_TRANSITION_VERTICE_NONE);
}

bool canvas_transition_text_block_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;
    bool selected = false;
    double x, y, w, h, ox, oy;

    ox = priv->current_region->ox;
    oy = priv->current_region->oy;

    ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                       &x, &y, &w, &h);
    double tx = t->text_block_coords.x + x + ox;
    double ty = t->text_block_coords.y + y + oy;
    double tw = t->text_block_coords.w;
    double th = t->text_block_coords.h;

    if (point_in_box2(priv->px, priv->py, tx - 10, ty - 10, tw + 20, th + 20)) {
        priv->tx = t->text_block_coords.x;
        priv->ty = t->text_block_coords.y;
        priv->tw = t->text_block_coords.w;
        priv->th = t->text_block_coords.h;
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

bool canvas_transition_dvertice_selected(void *context)
{
    return false;
}

void canvas_process_selection(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_state *selected_state;
    struct ufsmm_region *selected_region;
    struct ufsmm_coords *selected_text_block;
    enum ufsmm_resize_selector selected_text_block_corner;
    struct ufsmm_action_ref *selected_action_ref = NULL;
    double x, y, w, h;
    double ox, oy;

    L_DEBUG("Checking... px=%.2f py=%.2f", priv->px, priv->py);

    ox = priv->current_region->ox;
    oy = priv->current_region->oy;

    priv->selection = UFSMM_SELECTION_NONE;
    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    /* Check states and regions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        r->focus = false;
        ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);

        /*
        L_DEBUG("r '%s' <%f, %f> %f, %f, %f, %f", r->name,
                    priv->px + priv->ox,
                    priv->py + priv->oy,
                    x, y,
                    x + w, y + h); */

        if (point_in_box2(priv->px - priv->current_region->ox,
                          priv->py - priv->current_region->oy,
                                                    x, y, w, h)) {
            L_DEBUG("Region '%s' selected", r->name);
            priv->selection = UFSMM_SELECTION_REGION;
            priv->selected_region = r;
        }

        if (r->off_page && !r->draw_as_root)
            continue;

        for (s = r->state; s; s = s->next) {
            s->focus = false;
            ufsmm_get_state_absolute_coords(s, &x, &y, &w, &h);

            L_DEBUG("s '%s' <%f, %f> %f, %f, %f, %f", s->name,
                        priv->px + priv->current_region->ox,
                        priv->py + priv->current_region->oy,
                        x, y,
                        x + w, y + h);
            if (point_in_box2(priv->px - priv->current_region->ox,
                              priv->py - priv->current_region->oy,
                                                        x - 5, y - 5, w + 10, h + 10)) {
                L_DEBUG("State '%s' selected", s->name);
                priv->selection = UFSMM_SELECTION_STATE;
                priv->selected_state = s;
            }

            for (r2 = s->regions; r2; r2 = r2->next) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    /* Check transitions */
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        if (r->off_page && !r->draw_as_root)
            continue;

        for (s = r->state; s; s = s->next) {
            for (struct ufsmm_transition *t = s->transition; t; t = t->next) {
                struct ufsmm_vertice *v;
                double vsx, vsy, vex, vey;
                double tsx, tsy, tex, tey;
                double d;
                double rx, ry, rw, rh;

                L_DEBUG("Checking transitions from %s", s->name);
                t->focus = false;
                transition_calc_begin_end_point(s,
                                                t->source.side,
                                                t->source.offset,
                                                &tsx, &tsy);
                transition_calc_begin_end_point(t->dest.state,
                                                t->dest.side,
                                                t->dest.offset,
                                                &tex, &tey);

                ufsmm_get_region_absolute_coords(r, &rx, &ry, &rw, &rh);

                vsx = tsx + ox;
                vsy = tsy + oy;

                if (t->vertices) {
                    for (v = t->vertices; v; v = v->next) {
                        vex = v->x + ox + rx;
                        vey = v->y + oy + ry;

                        d = distance_point_to_seg(priv->px, priv->py,
                                                  vsx, vsy,
                                                  vex, vey);

                        //L_DEBUG("Segment d = %.2f", d);
                        if (d < 10.0) {
                            priv->selection = UFSMM_SELECTION_TRANSITION;
                            priv->selected_transition = t;
                            break;
                        }
                        vsx = v->x + ox + rx;
                        vsy = v->y + oy + ry;
                    }
                    vsx = vex;
                    vsy = vey;
                }
                vex = tex + ox;
                vey = tey + oy;

                d = distance_point_to_seg(priv->px, priv->py,
                                          vsx, vsy,
                                          vex, vey);
                L_DEBUG("d = %.2f", d);
                if (d < 10.0) {
                    priv->selection = UFSMM_SELECTION_TRANSITION;
                    priv->selected_transition = t;
                } else {
                    t->focus = false;
                }

                ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                                   &x, &y, &w, &h);
                double tx = t->text_block_coords.x + x + ox;
                double ty = t->text_block_coords.y + y + oy;
                double tw = t->text_block_coords.w;
                double th = t->text_block_coords.h;

                if (point_in_box2(priv->px, priv->py, tx - 10, ty - 10, tw + 20, th + 20)) {
                    L_DEBUG("Text-box selected <%.2f, %.2f> <%.2f, %.2f, %.2f, %.2f>",
                                priv->px, priv->py, tx, ty, tx + tw, ty + th);
                    t->focus = true;
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

#ifdef __NOPE__
                /* Check guards */

                for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next)
                    ar->focus = false;

                for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next)
                    ar->focus = false;

                for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next) {
                    if (point_in_box2(priv->px, priv->py, ar->x + ox, ar->y + oy, ar->w, ar->h)) {
                        ar->focus = true;
                        selected_action_ref = ar;
                    }
                }

                for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next) {
                    if (point_in_box2(priv->px, priv->py, ar->x + ox, ar->y + oy, ar->w, ar->h)) {
                        ar->focus = true;
                        selected_action_ref = ar;
                    }
                }
                if (t_focus) {
                    selected_transition = t;
                    L_DEBUG("Transition %s --> %s selected",
                                t->source.state->name, t->dest.state->name);
                    t->focus = true;
                    priv->redraw = true;
                }

#endif
            }

            for (r2 = s->regions; r2; r2 = r2->next)
            {

                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);

    switch (priv->selection) {
        case UFSMM_SELECTION_REGION:
            priv->selected_region->focus = true;
            priv->redraw = true;
        break;
        case UFSMM_SELECTION_STATE:
            priv->selected_state->focus = true;
            priv->redraw = true;
        break;
        case UFSMM_SELECTION_TRANSITION:
            priv->selected_transition->focus = true;
            priv->redraw = true;
        break;
        default:
        break;
    }
}

