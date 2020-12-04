#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

void canvas_process_selection(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_state *selected_state;
    struct ufsmm_region *selected_region;
    struct ufsmm_transition *selected_transition;
    struct ufsmm_coords *selected_text_block;
    enum ufsmm_resize_selector selected_text_block_corner;
    struct ufsmm_action_ref *selected_action_ref = NULL;
    double x, y, w, h;
    double ox, oy;

    L_DEBUG("Checking...");

    ox = priv->ox / priv->scale;
    oy = priv->oy / priv->scale;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, priv->current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r->off_page && !r->draw_as_root)
            continue;

        for (s = r->state; s; s = s->next)
        {
            for (struct ufsmm_transition *t = s->transition; t; t = t->next) {
                struct ufsmm_vertice *v;
                double vsx, vsy, vex, vey;
                double tsx, tsy, tex, tey;
                double d;
                bool t_focus = false;
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
                vsx = tsx + ox;
                vsy = tsy + oy;

                if (t->vertices) {
                    for (v = t->vertices; v; v = v->next) {
                        vex = v->x + ox;
                        vey = v->y + oy;

                        d = distance_point_to_seg(priv->px, priv->py,
                                                  vsx, vsy,
                                                  vex, vey);


                        if (d < 10.0) {
                            t_focus = true;
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
                if (d < 10.0)
                    t_focus = true;

                ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                                   &x, &y, &w, &h);
                double tx = t->text_block_coords.x + x + ox;
                double ty = t->text_block_coords.y + y + oy;
                double tw = t->text_block_coords.w;
                double th = t->text_block_coords.h;

                if (point_in_box2(priv->px, priv->py, tx - 10, ty - 10, tw + 20, th + 20)) {
                    L_DEBUG("Text-box selected <%.2f, %.2f> <%.2f, %.2f, %.2f, %.2f>",
                                priv->px, priv->py, tx, ty, tx + tw, ty + th);
                    t_focus = true;
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
                    if (selected_state)
                        selected_state->focus = false;
                    if (selected_region)
                        selected_region->focus = false;
                }
            }
            for (r2 = s->regions; r2; r2 = r2->next)
            {

                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);
}
