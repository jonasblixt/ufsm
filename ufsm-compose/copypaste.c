#include <stdio.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include <ufsm/model.h>
#include "logic/canvas.h"
#include "render.h"

struct ufsmm_state_pair {
    struct ufsmm_state *s1, *s2;
    TAILQ_ENTRY(ufsmm_state_pair) tailq;
};

TAILQ_HEAD(ufsmm_state_pairs, ufsmm_state_pair);

static struct ufsmm_state *ufsmm_state_shallow_copy(struct ufsmm_state *state,
                                                    struct ufsmm_undo_ops *undo_ops)
{
    struct ufsmm_state *new = ufsmm_state_new(state->kind);
    struct ufsmm_action_ref *aref, *new_aref;

    new->x = state->x;
    new->y = state->y;
    new->w = state->w;
    new->h = state->h;
    new->name = strdup(state->name);
    new->region_y_offset = state->region_y_offset;
    new->resizeable = state->resizeable;
    new->orientation = state->orientation;
    new->parent_region = state->parent_region;

    if (undo_ops) {
        ufsmm_undo_add_state(undo_ops, new);
    }

    TAILQ_FOREACH(aref, &state->entries, tailq) {
        new_aref = ufsmm_action_ref_copy(aref);
        TAILQ_INSERT_TAIL(&new->entries, new_aref, tailq);
        if (undo_ops) {
            ufsmm_undo_add_aref(undo_ops, &new->entries, new_aref);
        }
    }

    TAILQ_FOREACH(aref, &state->exits, tailq) {
        new_aref = ufsmm_action_ref_copy(aref);
        TAILQ_INSERT_TAIL(&new->exits, new_aref, tailq);
        if (undo_ops) {
            ufsmm_undo_add_aref(undo_ops, &new->entries, new_aref);
        }
    }
    return new;
}
static struct ufsmm_transition* ufsmm_transition_copy(struct ufsmm_transition *t,
                                                      struct ufsmm_undo_ops *undo_ops)
{
    struct ufsmm_transition *new;
    struct ufsmm_action_ref *aref, *new_aref;
    struct ufsmm_guard_ref *gref, *new_gref;
    struct ufsmm_vertice *v, *new_v;

    if (ufsmm_transition_new(&new) != UFSMM_OK)
        return NULL;

    new->trigger = t->trigger;
    new->kind = t->kind;

    if (undo_ops) {
        ufsmm_undo_add_transition(undo_ops, new);
    }

    TAILQ_FOREACH(gref, &t->guards, tailq) {
        new_gref = ufsmm_guard_ref_copy(gref);
        TAILQ_INSERT_TAIL(&new->guards, new_gref, tailq);
        if (undo_ops) {
            ufsmm_undo_add_guard(undo_ops, t, new_gref);
        }

    }

    TAILQ_FOREACH(aref, &t->actions, tailq) {
        new_aref = ufsmm_action_ref_copy(aref);
        TAILQ_INSERT_TAIL(&new->actions, new_aref, tailq);
        if (undo_ops) {
            ufsmm_undo_add_aref(undo_ops, &new->actions, new_aref);
        }
    }

    new->source.state = t->source.state;
    new->source.offset = t->source.offset;
    new->source.side = t->source.side;

    new->dest.state = t->dest.state;
    new->dest.offset = t->dest.offset;
    new->dest.side = t->dest.side;

    new->text_block_coords.x = t->text_block_coords.x;
    new->text_block_coords.y = t->text_block_coords.y;
    new->text_block_coords.w = t->text_block_coords.w;
    new->text_block_coords.h = t->text_block_coords.h;

    TAILQ_FOREACH(v, &t->vertices, tailq) {
        new_v = malloc(sizeof(*new_v));
        new_v->x = v->x;
        new_v->y = v->y;
        TAILQ_INSERT_TAIL(&new->vertices, new_v, tailq);
        if (undo_ops) {
            ufsmm_undo_add_vertice(undo_ops, t, new_v,
                                   TAILQ_PREV(new_v, ufsmm_vertices, tailq),
                                   NULL);
        }
    }

    return new;
}

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
                new_ps = ufsmm_state_shallow_copy(s, NULL);
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
                        new_t = ufsmm_transition_copy(t, NULL);
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
    struct ufsmm_undo_ops *undo_ops = ufsmm_undo_new_ops();

    double x_min = 1e9;
    double x_max = -1e9;
    double y_min = 1e9;
    double y_max = -1e9;


    TAILQ_INIT(&state_pairs);
    if (priv->selection == UFSMM_SELECTION_REGION)
        target_region = priv->selected_region;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push_sr_pair(stack, NULL, priv->copy_bfr);

    while (ufsmm_stack_pop_sr_pair(stack, &ps, &r) == UFSMM_OK) {
        if (r != priv->copy_bfr) {
            ufsmm_add_region(ps, r->off_page, &new_pr);
            ufsmm_undo_add_region(undo_ops, new_pr);
            new_pr->name = strdup(r->name);
            new_pr->h = r->h;
        }

        TAILQ_FOREACH(s, &r->states, tailq) {
            new_ps = ufsmm_state_shallow_copy(s, undo_ops);
            new_ps->selected = true;
            if (x_min > s->x)
                x_min = s->x;
            if (x_max < s->x)
                x_max = s->x;

            if (y_min > (s->y + s->h))
                y_min = s->y + s->h;
            if (y_max < (s->y + s->h))
                y_max = s->y + s->h;

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
                new_t = ufsmm_transition_copy(t, undo_ops);
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

    ufsmm_undo_commit_ops(priv->undo, undo_ops);

    /* TODO: This is not working as intended. The pasted buffer
     *      should be centered on the cursor */
    //priv->px = x_max;
    //priv->py = y_max;
    priv->sx = priv->px; //+ x_min;//(x_max - x_min) / 2;
    priv->sy = priv->py; // + y_min;//(y_max - y_min) / 2;

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
