#include <stdio.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include <ufsm/model.h>
#include "canvas/logic/canvas.h"
#include "canvas/view.h"

struct ufsmm_state_pair {
    struct ufsmm_state *s1, *s2;
    TAILQ_ENTRY(ufsmm_state_pair) tailq;
};

TAILQ_HEAD(ufsmm_state_pairs, ufsmm_state_pair);

static int add_state_pair(struct ufsmm_state_pairs *list,
                          struct ufsmm_state *s1,
                          struct ufsmm_state *s2)
{
    struct ufsmm_state_pair *state_pair = malloc(sizeof(struct ufsmm_state_pair));
    if (state_pair == NULL)
        return -1;

    memset(state_pair, 0, sizeof(*state_pair));
    state_pair->s1 = s1;
    state_pair->s2 = s2;

    TAILQ_INSERT_TAIL(list, state_pair, tailq);
    return 0;
}

void canvas_copy_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *cr = priv->current_region;
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2, *pr, *new_pr;
    struct ufsmm_state *s, *ps, *new_ps;
    struct ufsmm_transition *t, *new_t;
    struct ufsmm_state_pairs state_pairs;
    struct ufsmm_state_pair *state_pair;
    struct ufsmm_guard_ref *gref;

    TAILQ_INIT(&state_pairs);

    // Create a temporary region to hold copies of states
    ufsmm_add_region(NULL, false, &priv->copy_bfr);

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    /*  Mark possible descendants of selected objects as selected
     *  as well.
     **/

    ufsmm_stack_push(stack, cr);
    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            s->selected = s->selected || r->selected;

            if (s->selected) {
                TAILQ_FOREACH(t, &s->transitions, tailq) {
                    /* Mark self transitions on selected states
                     *  as selected*/
                    if ((t->source.state == s) &&
                        (t->dest.state == s)) {
                        t->selected = true;
                    } else if (r->selected) {
                        /* Transitions originating from states in a selected
                         * region should possible be copied, mark as selected.
                         *
                         * In the next iteration of the selection the transition
                         * is copied if the destination state is also selected.*/
                        t->selected = true;
                    }
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                r2->selected = r2->selected || s->selected;
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    /* Create copies of everything that is selected and place
     * copies in the copy_bfr region */
    ufsmm_stack_push_sr_pair(stack, NULL, cr);

    while (ufsmm_stack_pop_sr_pair(stack, &ps, &r) == UFSMM_OK) {
        if (r->selected) {
            ufsmm_add_region(ps, r->off_page, &new_pr);
            new_pr->name = strdup(r->name);
            new_pr->h = r->h;
        }

        TAILQ_FOREACH(s, &r->states, tailq) {
            new_ps = NULL;
            if (s->selected) {
                new_ps = ufsmm_state_shallow_copy(s);
                /* If the parent region of this state is not selected
                 *  it should be in the copy_bfr root region. This should
                 *  state should also be pasted directly onto the target
                 *  selected region */
                if (r->selected) {
                    ufsmm_region_append_state(new_pr, new_ps);
                } else {
                    ufsmm_region_append_state(priv->copy_bfr, new_ps);
                }
                /* Keep track of the old and new states. This is
                 * done to update transition destination states in the
                 * next step*/
                add_state_pair(&state_pairs, s, new_ps);

                TAILQ_FOREACH(t, &s->transitions, tailq) {
                    if (t->source.state->selected &&
                        t->dest.state->selected &&
                        t->selected) {
                        L_DEBUG("Copy transition %s->%s",
                                                    t->source.state->name,
                                                    t->dest.state->name);
                        new_t = ufsmm_transition_copy(t);
                        new_t->source.state = new_ps;
                        /* The destination state is updated in the next step */
                        TAILQ_INSERT_TAIL(&new_ps->transitions, new_t, tailq);
                    } else {
                        t->selected = false;
                    }
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push_sr_pair(stack, new_ps, r2);
            }
        }
    }

    /* Update dangling transition destinations and state conditions */
    ufsmm_stack_push(stack, priv->copy_bfr);
    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                TAILQ_FOREACH(state_pair, &state_pairs, tailq) {
                    if (state_pair->s1 == t->dest.state) {
                        t->dest.state = state_pair->s2;
                    }
                    /* If the transition referenced a state in a state
                     *  condition guard, that was also copied, the
                     *  state reference should be updated to point to the copy*/
                    TAILQ_FOREACH(gref, &t->guards, tailq) {
                        if ((gref->kind == UFSMM_GUARD_PSTATE) ||
                            (gref->kind == UFSMM_GUARD_NSTATE)) {

                            if (gref->state == state_pair->s1) {
                                gref->state = state_pair->s2;
                            }
                        }
                    }
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);

    while (state_pair = TAILQ_FIRST(&state_pairs)) {
        TAILQ_REMOVE(&state_pairs, state_pair, tailq);
        free(state_pair);
    }
}

void canvas_paste_copy_buffer(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *target_region = priv->current_region;
    struct ufsmm_state *s, *ps, *new_ps;
    struct ufsmm_region *r, *r2, *new_pr;
    struct ufsmm_stack *stack;
    struct ufsmm_transition *t, *new_t;
    struct ufsmm_state_pairs state_pairs;
    struct ufsmm_state_pair *state_pair;
    struct ufsmm_guard_ref *gref;

    TAILQ_INIT(&state_pairs);
    if (priv->selection == UFSMM_SELECTION_REGION)
        target_region = priv->selected_region;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push_sr_pair(stack, NULL, priv->copy_bfr);

    while (ufsmm_stack_pop_sr_pair(stack, &ps, &r) == UFSMM_OK) {
        if (r != priv->copy_bfr) {
            ufsmm_add_region(ps, r->off_page, &new_pr);
            new_pr->name = strdup(r->name);
            new_pr->h = r->h;
        }

        TAILQ_FOREACH(s, &r->states, tailq) {
            new_ps = ufsmm_state_shallow_copy(s);
            new_ps->selected = true;
            if (r != priv->copy_bfr) {
                ufsmm_region_append_state(new_pr, new_ps);
            } else {
                ufsmm_region_append_state(target_region, new_ps);
            }
            /* Keep track of the old and new states. This is
             * done to update transition destination states in the
             * next step*/
            add_state_pair(&state_pairs, s, new_ps);

            TAILQ_FOREACH(t, &s->transitions, tailq) {
                new_t = ufsmm_transition_copy(t);
                new_t->selected = true;
                new_t->source.state = new_ps;
                /* The destination state is updated in the next step */
                TAILQ_INSERT_TAIL(&new_ps->transitions, new_t, tailq);
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push_sr_pair(stack, new_ps, r2);
            }
        }
    }


    /* Update dangling transition destinations and state conditions */
    ufsmm_stack_push(stack, target_region);
    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            if (!s->selected)
                continue;
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if (!t->selected)
                    continue;
                TAILQ_FOREACH(state_pair, &state_pairs, tailq) {
                    if (state_pair->s1 == t->dest.state) {
                        t->dest.state = state_pair->s2;
                    }
                    /* If the transition referenced a state in a state
                     *  condition guard, that was also copied, the
                     *  state reference should be updated to point to the copy*/
                    TAILQ_FOREACH(gref, &t->guards, tailq) {
                        if ((gref->kind == UFSMM_GUARD_PSTATE) ||
                            (gref->kind == UFSMM_GUARD_NSTATE)) {

                            if (gref->state == state_pair->s1) {
                                gref->state = state_pair->s2;
                            }
                        }
                    }
                }
            }
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);

    while (state_pair = TAILQ_FIRST(&state_pairs)) {
        TAILQ_REMOVE(&state_pairs, state_pair, tailq);
        free(state_pair);
    }

    priv->redraw = true;
}

void canvas_copy_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s;
    struct ufsmm_region *r, *r2;
    struct ufsmm_stack *stack, *stack2;
    struct ufsmm_transition *t;
    struct ufsmm_action_ref *aref;
    void *ptr;

    /* Clean-up */

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_init(&stack2, UFSMM_MAX_R_S);

    ufsmm_stack_push(stack, priv->copy_bfr);
    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        free((void *) r->name);
        ufsmm_stack_push(stack2, r);

        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_stack_push(stack2, s);

            while (t = TAILQ_FIRST(&s->transitions)) {
                TAILQ_REMOVE(&s->transitions, t, tailq);
                ufsmm_transition_free_one(t);
            }
            free_action_ref_list(&s->entries);
            free_action_ref_list(&s->exits);

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }

            free((void *) s->name);
        }
    }

    while (ufsmm_stack_pop(stack2, &ptr) == UFSMM_OK) {
        free(ptr);
    }

    ufsmm_stack_free(stack);
    ufsmm_stack_free(stack2);
}

void canvas_cut_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    canvas_copy_begin(context);
    canvas_mselect_delete(context);
    priv->redraw = true;
}

void canvas_paste_cut_buffer(void *context)
{
    canvas_paste_copy_buffer(context);
}

void canvas_cut_end(void *context)
{
    canvas_copy_end(context);
}
