#include <stdio.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include <ufsm/model.h>
#include "canvas/logic/canvas.h"
#include "canvas/view.h"

struct ufsmm_copy_op {
    struct ufsmm_states states;
    struct ufsmm_transitions transitions;
};

static struct ufsmm_copy_op copy_op;

void canvas_copy_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s, *s2;
    struct ufsmm_transition *t;

    memset(&copy_op, 0, sizeof(copy_op));

    TAILQ_INIT(&copy_op.states);
    TAILQ_INIT(&copy_op.transitions);

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
/*
    ufsmm_stack_push(stack, cr);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            s->selected = s->selected || r->selected;

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                r2->selected = r2->selected || s->selected;
                ufsmm_stack_push(stack, r2);
            }
        }
    }
*/
    /* Check states */
    ufsmm_stack_push(stack, cr);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            if (s->selected) {
                if (s->parent_region == cr) {
                    L_DEBUG("Copy %s", s->name); /* Root state that should be moved */
                    //mselect_add_state(&op->states, &op->transitions, s);
                } else {
                    for (r2 = s->parent_region; r2->parent_state;
                                        r2 = r2->parent_state->parent_region) {
                        if (r2 == cr)
                            break;
                        if ((r2->parent_state->selected == false)) {
                            L_DEBUG("Copy %s", s->name); /* Root state that should be moved */
                            //mselect_add_state(&op->states, &op->transitions, s);
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
                        s2 = t->dest.state;

                        for (s2 = t->dest.state; s2; s2 = s2->parent_region->parent_state) {
                            if (s2->selected) {
                                L_DEBUG("Copy transition %s->%s",
                                    t->source.state->name, t->dest.state->name);
                                //mselect_add_transition(&op->transitions, t);
                            }
                            if (s2->parent_region == priv->current_region)
                                break;
                        }
                    } else if (t->dest.state == s) {
                        /* Self transition */
                        //mselect_add_transition(&op->transitions, t);
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

void canvas_paste_copy_buffer(void *context)
{
}

void canvas_copy_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r;
    int rc;

    /* Clean-up */
#ifdef __NOPE
    while (ms = TAILQ_FIRST(&op->states)) {
        TAILQ_REMOVE(&op->states, ms, tailq);
        struct ufsmm_state *s = ms->state;
        L_DEBUG("Moved state '%s'", s->name);
        /* Check if state should have a new parent region */
        rc = ufsmm_region_get_at_xy(priv, priv->current_region,
                                    s->x + s->w/2 + priv->current_region->ox,
                                    s->y + s->h/2 + priv->current_region->oy,
                                    &r, NULL);

        if (rc == UFSMM_OK) {
            if (r != s->parent_region) {
                L_DEBUG("State '%s' new pr = '%s'", s->name, r->name);
                ufsmm_state_move_to_region(priv->model, s, r);
            }
        }
        free(ms);
    }

    while (mt = TAILQ_FIRST(&op->transitions)) {
        TAILQ_REMOVE(&op->transitions, mt, tailq);
        L_DEBUG("Moved transition '%s->%s'", mt->transition->source.state->name,
                                             mt->transition->dest.state->name);
        free(mt);
    }
#endif
}

void canvas_cut_begin(void *context)
{
}

void canvas_paste_cut_buffer(void *context)
{
}

void canvas_cut_end(void *context)
{
}
