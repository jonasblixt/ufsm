/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include "ufsm.h"

const char *ufsm_transition_kinds[] =
{
    "External",
    "Internal",
    "Local",
};

const char *ufsm_state_kinds[] =
{
    "Simple",
    "Init",
    "Final",
    "Shallow history",
    "Deep history",
    "Exit point",
    "Entry point",
    "Join",
    "Fork",
    "Choice",
    "Junction",
    "Terminate",
};

const char *ufsm_errors[] =
{
    "OK",
    "Error",
    "No init region found",
    "Unknown state kind",
    "Event not processed",
    "No least common ancestor found",
    "Stack overflow",
    "Stack underflow",
    "Queue empty",
    "Queue full",
    "Machine has terminated",
};

struct internal_state {
    bool cant_exit;
    bool completion;
};

struct internal_region {
    struct ufsm_state *current;
    struct ufsm_state *history;
};

inline static const struct ufsm_state* ufsm_get_current_state(struct ufsm_machine *m,
                                                   const struct ufsm_region *r)
{
    if (r)
        return m->r_data[r->index].current;
    else
        return NULL;
}

inline static bool ufsm_state_is(const struct ufsm_state *s, int kind)
{
    return s ? ((int) s->kind == kind) : false;
}

static int ufsm_make_transition(struct ufsm_machine *m,
                                const struct ufsm_transition *t,
                                const struct ufsm_region *r);

static int ufsm_process_completion(struct ufsm_machine *m,
                                   const struct ufsm_state *s)
{
    int err = UFSM_OK;

    for (const struct ufsm_transition *t = s->transition; t; t = t->next)
    {
        if (t->trigger == NULL)
        {
            err = ufsm_make_transition(m, t, s->parent_region);
            break;
        }
    }

    return err;
}

static int ufsm_completion_handler(struct ufsm_machine *m,
                                   const struct ufsm_state *s)
{
    int err = UFSM_OK;

    for (const struct ufsm_transition *t = s->transition; t; t = t->next) {
        if (t->trigger == NULL) {
            err = ufsm_stack_push(&m->completion_stack, s);
            if (err == UFSM_OK)
                err = ufsm_queue_put(&m->queue, UFSM_COMPLETION_EVENT);
        }
    }

    return err;
}

static int ufsm_enter_state(struct ufsm_machine *m, const struct ufsm_state *s)
{
    int err = UFSM_OK;

    bool state_completed = false;

    if (m->debug_enter_state)
        m->debug_enter_state(s);

    for (const struct ufsm_entry_exit *e = s->entry; e; e = e->next)
    {
        if (m->debug_entry_exit)
            m->debug_entry_exit(e);
        e->f(m->context);
    }

    /* If it's a normal state, first asume that it can complete */
    if (s->kind == UFSM_STATE_SIMPLE) {
        state_completed = true;

        /* If there are any regions in this state that have active states
         *  it should not complete */
        for (const struct ufsm_region *r = s->region; r; r = r->next) {
            const struct ufsm_state *current = ufsm_get_current_state(m, r);
            if (current) {
                if (current->kind != UFSM_STATE_FINAL)
                    state_completed = false;
            } else {
                state_completed = false;
            }
        }

        if (state_completed)
            ufsm_completion_handler(m, s);
    }

    return err;
}

inline static void ufsm_leave_state(struct ufsm_machine *m,
                                    const struct ufsm_state *s)
{
    if (m->debug_exit_state)
        m->debug_exit_state(s);

    if (s == NULL)
        return;

    for (const struct ufsm_entry_exit *e = s->exit; e; e = e->next)
    {
        if (m->debug_entry_exit)
            m->debug_entry_exit(e);
        e->f(m->context);
    }
}


inline static void ufsm_set_current_state(struct ufsm_machine *m,
                                          const struct ufsm_region *r,
                                          const struct ufsm_state *s)
{
    if (r) {
        m->r_data[r->index].current = (struct ufsm_state *) s;
    }
}

inline static bool ufsm_test_guards(struct ufsm_machine *m,
                                    const struct ufsm_transition *t)
{
    bool result = true;

    for (const struct ufsm_guard *g = t->guard; g; g = g->next)
    {
        bool guard_result = g->f(m->context);

        if (m->debug_guard)
            m->debug_guard(g, guard_result);

        if (!guard_result)
            result = false;
    }

    return result;
}

inline static void ufsm_execute_actions(struct ufsm_machine *m,
                                        const struct ufsm_transition *t)
{
    for (const struct ufsm_action *a = t->action; a; a = a->next)
    {
        if (m->debug_action)
            m->debug_action(a);

        a->f(m->context);
    }
}

inline static void ufsm_update_history(struct ufsm_machine *m,
                                       const struct ufsm_state *s)
{
    if (s->parent_region) {
        if (s->parent_region->has_history) {
            const struct ufsm_region *r = s->parent_region;
            m->r_data[r->index].history = (struct ufsm_state *) s;
        }
    }
}

static const struct ufsm_transition *ufsm_get_first_state (const struct ufsm_region *region)
{

    for (const struct ufsm_state *s = region->state; s; s = s->next)
    {
        if (ufsm_state_is(s, UFSM_STATE_INIT) ||
            ufsm_state_is(s, UFSM_STATE_SHALLOW_HISTORY) ||
            ufsm_state_is(s, UFSM_STATE_DEEP_HISTORY))
        {
            return s->transition;
        }
    }

    return NULL;
}

static int ufsm_enter_parent_states(struct ufsm_machine *m,
                                    const struct ufsm_region *ancestor,
                                    const struct ufsm_region *r)
{
    int err = UFSM_OK;
    int c = 0;

    const struct ufsm_state *ps = r->parent_state;
    const struct ufsm_region *pr = NULL;

    if (!ancestor)
        return UFSM_OK;

    err = ufsm_stack_push(&m->stack, r);
    c++;

    while (ps && (r != ancestor) && (err == UFSM_OK))
    {
        pr = ps->parent_region;

        if ((pr == ancestor) || (pr == NULL))
            break;

        err = ufsm_stack_push(&m->stack, pr);

        c++;

        ps = pr->parent_state;
    }

    for (int i = 0; i < c; i++)
    {
        err = ufsm_stack_pop(&m->stack, (void **) &pr);

        if (err != UFSM_OK)
            break;

        if (m->debug_enter_region)
            m->debug_enter_region(pr);

        ps = pr->parent_state;

        const struct ufsm_state *current = ufsm_get_current_state(m, ps->parent_region);
        if (ps && current != ps)
        {
            ufsm_set_current_state(m, ps->parent_region, ps);

            if (pr != ancestor)
                ufsm_enter_state(m, ps);
        }
    }

    return err;
}

static const struct ufsm_region * ufsm_least_common_ancestor(const struct ufsm_region *r1,
                                                       const struct ufsm_region *r2)
{
    const struct ufsm_region *lca = r1;
    const struct ufsm_region *lca2 = r2;

    while (lca)
    {
        lca2 = r2;
        do
        {
            if (lca == lca2)
                return lca;

            if (lca2->parent_state == NULL)
                break;

            lca2 = lca2->parent_state->parent_region;

        } while(lca2);

        if (lca->parent_state == NULL)
            break;

        lca = lca->parent_state->parent_region;
    }

    return NULL;
}

static int ufsm_leave_parent_states(struct ufsm_machine *m,
                                    const struct ufsm_state *src,
                                    const struct ufsm_state *dest,
                                    const struct ufsm_region **lca,
                                    const struct ufsm_region **act)
{
    const struct ufsm_region *rl = NULL;
    const struct ufsm_region *ancestor = NULL;
    bool states_to_leave = true;

    if ( !((src->parent_region != dest->parent_region) &&
            dest->kind != UFSM_STATE_JOIN))
        return UFSM_OK;

    *act = dest->parent_region;
    rl = src->parent_region;

    ancestor = ufsm_least_common_ancestor(src->parent_region,
                                        dest->parent_region);
    *lca = ancestor;

    if (!ancestor)
        return UFSM_ERROR_LCA_NOT_FOUND;

    while (states_to_leave)
    {
        if (ancestor == rl)
            break;

        if (m->debug_leave_region)
            m->debug_leave_region(rl);

        if (rl->parent_state)
        {
            ufsm_leave_state(m, rl->parent_state);
            m->r_data[rl->index].current = NULL;

            if (rl->parent_state->parent_region)
            {
                rl = rl->parent_state->parent_region;
                states_to_leave = true;
            }

        }
        else
        {
            states_to_leave = false;
        }

    }

    return UFSM_OK;
}

inline static int ufsm_push_sr_pair(struct ufsm_machine *m,
                                    const struct ufsm_region *r,
                                    const struct ufsm_state *s)
{
    int err = UFSM_OK;

    err = ufsm_stack_push (&m->stack, r);

    if (err == UFSM_OK)
        err = ufsm_stack_push (&m->stack, s);

    return err;
}

inline static int ufsm_pop_sr_pair(struct ufsm_machine *m,
                                   struct ufsm_region **r,
                                   struct ufsm_state **s)
{
    int err = UFSM_OK;

    err = ufsm_stack_pop (&m->stack, (void **) s);

    if (err == UFSM_OK)
        err = ufsm_stack_pop (&m->stack, (void **) r);

    return err;
}

static int ufsm_find_active_regions(struct ufsm_machine *m,
                                    const struct ufsm_region *r_in,
                                    int *c)
{
    int err;
    const struct ufsm_state *s = NULL;
    const struct ufsm_region *r = r_in;

    err = ufsm_stack_push(&m->stack2, r);

    if (err != UFSM_OK)
        return err;

    while (ufsm_stack_pop(&m->stack2, (void **) &r) == UFSM_OK) {
        for (; r; r = r->next) {
            s = ufsm_get_current_state(m, r);

            if (s) {
                m->s_data[s->index].cant_exit = false;
                err = ufsm_push_sr_pair(m, r, s);

                if (err != UFSM_OK) {
                    goto err_out;
                }

                *c = *c + 1;

                if (s->region) {
                    err = ufsm_stack_push(&m->stack2, s->region);
                    if (err != UFSM_OK) {
                        goto err_out;
                    }
                }
            }
        }
    }

err_out:
    return err;
}

static int ufsm_leave_nested_states(struct ufsm_machine *m,
                                    const struct ufsm_state *s)
{
    struct ufsm_region *r = NULL;
    struct ufsm_state *s2 = NULL;
    int c = 0;
    int err = UFSM_OK;

    const struct ufsm_state *current  = ufsm_get_current_state(m, s->region);
    if (!s->region || !current)
        return UFSM_OK;

    err = ufsm_find_active_regions(m, s->region, &c);

    if (err != UFSM_OK)
        return err;

    for (int i = 0; i < c; i++)
    {
        err = ufsm_pop_sr_pair(m, &r, &s2);

        if (err != UFSM_OK)
            break;

        ufsm_leave_state(m, s2);

        if (r->has_history) {
            m->r_data[r->index].history = m->r_data[r->index].current;
        }
        m->r_data[r->index].current = NULL;
    }

    return err;
}

static int ufsm_init_region_history(struct ufsm_machine *m,
                                    const struct ufsm_region *regions)
{
    int err = UFSM_ERROR_NO_INIT_REGION;

    const struct ufsm_state *history = m->r_data[regions->index].history;

    if (regions->has_history && history)
    {
        m->r_data[regions->index].current = (struct ufsm_state *) history;

        if (m->debug_enter_region)
            m->debug_enter_region(regions);

        ufsm_enter_state(m, m->r_data[regions->index].current);
        err = UFSM_OK;
    }

    return err;
}


inline static int ufsm_push_rt_pair(struct ufsm_machine *m,
                                    const struct ufsm_region *r,
                                    const struct ufsm_transition *t)
{
    int err = UFSM_OK;

    err = ufsm_stack_push (&m->stack, r);

    if (err == UFSM_OK)
        err = ufsm_stack_push (&m->stack, t);

    return err;
}

inline static int ufsm_pop_rt_pair(struct ufsm_machine *m,
                                   const struct ufsm_region **r,
                                   const struct ufsm_transition **t)
{
    int err = UFSM_OK;

    err = ufsm_stack_pop (&m->stack, (void **) t);

    if (err == UFSM_OK)
        err = ufsm_stack_pop (&m->stack, (void **) r);

    return err;
}

static int ufsm_process_regions(struct ufsm_machine *m,
                                const struct ufsm_state *dest,
                                int *c)
{
    int err = UFSM_OK;
    const struct ufsm_region *r = dest->region;

    for (const struct ufsm_region *s_r = r; s_r; s_r = s_r->next)
    {
        const struct ufsm_transition *init_t = ufsm_get_first_state(s_r);

        if (init_t == NULL) {
            err = ufsm_init_region_history(m, s_r);
        } else {
            err = ufsm_push_rt_pair(m, s_r, init_t);
            *c = *c + 1;
        }

        if (err != UFSM_OK)
            break;
    }

    return err;
}

static int ufsm_process_entry_exit_points(struct ufsm_machine *m,
                                          const struct ufsm_state *dest,
                                          int *c)
{
    int err = UFSM_OK;

    for (const struct ufsm_state *s = dest->parent_region->state; s; s = s->next) {
        for (const struct ufsm_transition *te = s->transition; te; te = te->next)
        {
            if (te->source == dest)
            {
                err = ufsm_push_rt_pair(m, te->dest->parent_region, te);

                if (err != UFSM_OK)
                    break;

                *c = *c + 1;
            }
        }
    }
    return err;
}

static int ufsm_process_final_state(struct ufsm_machine *m,
                                    const struct ufsm_region *act_region,
                                    const struct ufsm_state *dest,
                                    int *c)
{
    int err = UFSM_OK;
    bool super_exit = false;
    const struct ufsm_state *parent_state = act_region->parent_state;

    m->r_data[act_region->index].current = (struct ufsm_state *) dest;

    if (dest->kind == UFSM_STATE_FINAL && parent_state)
    {
        super_exit = true;
        for (const struct ufsm_region *ar = parent_state->region; ar; ar = ar->next)
        {
            const struct ufsm_state *current = m->r_data[ar->index].current;
            if (current)
                if (current->kind != UFSM_STATE_FINAL)
                    super_exit = false;
        }
    }

    if (super_exit && parent_state)
    {
        const struct ufsm_region *parent_region = parent_state->region;

        for (const struct ufsm_region *ar = parent_region; ar; ar = ar->next) {
            const struct ufsm_state *current = m->r_data[ar->index].current;
            ufsm_leave_state(m, current);
        }
        for (const struct ufsm_state *s = parent_state->region->state; s; s = s->next) {
            for (const struct ufsm_transition *tf = s->transition; tf; tf = tf->next) {
                if (tf->trigger == NULL &&
                    tf->source == parent_state)
                {
                    m->s_data[parent_state->index].cant_exit = false;
                    err = ufsm_push_rt_pair(m, parent_state->parent_region, tf);

                    if (err != UFSM_OK)
                        break;

                    *c = *c + 1;
                }
            }
        }
    }

    return err;
}

static int ufsm_process_fork(struct ufsm_machine *m,
                             const struct ufsm_region *act_region,
                             const struct ufsm_state *dest,
                             int *c)
{
    int err = UFSM_OK;

    for (const struct ufsm_state *s = act_region->state; s; s = s->next) {
        for (const struct ufsm_transition *tf = s->transition; tf; tf = tf->next)
        {
            if (tf->source == dest)
            {
                err = ufsm_push_rt_pair(m, act_region, tf);

                if (err != UFSM_OK)
                    break;

                *c = *c + 1;
            }
        }
    }

    return err;
}

static int ufsm_process_join(struct ufsm_machine *m,
                             const struct ufsm_region *act_region,
                             const struct ufsm_state *src,
                             const struct ufsm_state *dest,
                             int *c)
{
    bool exec_join = true;
    int err = UFSM_OK;
    struct ufsm_region *orth_region = NULL;

    if (!src->parent_region->parent_state)
        return UFSM_ERROR_EVENT_NOT_PROCESSED;

    orth_region = (struct ufsm_region *) src->parent_region->parent_state->region;

    m->r_data[src->parent_region->index].current = (struct ufsm_state *) dest;
    for (const struct ufsm_region *dr = orth_region; dr; dr = dr->next)
    {
        const struct ufsm_state *current = m->r_data[dr->index].current;
        if (current != dest)
            exec_join = false;
    }

    if (exec_join)
    {

        for (const struct ufsm_state *s = dest->parent_region->state; s; s = s->next) {
            for (const struct ufsm_transition *dt = s->transition; dt; dt = dt->next) {
                if (dt->source == dest)
                {
                    err = ufsm_push_rt_pair(m, dest->parent_region, dt);

                    if (err != UFSM_OK)
                        break;
                    *c = *c + 1;
                }
            }
        }
    }

    return err;
}

static int ufsm_process_choice(struct ufsm_machine *m,
                               const struct ufsm_region *act_region,
                               const struct ufsm_state *dest,
                               int *c)
{
    int err = UFSM_OK;
    const struct ufsm_transition *t_default = NULL;
    bool made_transition = false;

    for (const struct ufsm_state *s = dest->parent_region->state; s; s = s->next) {
        for (const struct ufsm_transition *dt = s->transition; dt; dt = dt->next) {
            if (dt->source == dest) {
                if (dt->guard) {
                    if (ufsm_test_guards(m, dt)) {
                        err = ufsm_push_rt_pair(m, act_region, dt);

                        if (err != UFSM_OK)
                            break;
                        made_transition = true;
                        *c = *c + 1;
                        break;
                    }
                } else {
                    t_default = dt;
                }
            }
        }
    }

    if (!made_transition && t_default && err == UFSM_OK) {
        err = ufsm_push_rt_pair(m, act_region, t_default);
        *c = *c + 1;
    }

    return err;
}

static int ufsm_process_junction(struct ufsm_machine *m,
                                 const struct ufsm_state *dest,
                                 int *c)
{
    int err = UFSM_OK;

    for (const struct ufsm_state *s = dest->parent_region->state; s; s = s->next) {
        for (const struct ufsm_transition *t = s->transition; t; t = t->next) {
            if (t->source == dest) {
                err = ufsm_push_rt_pair(m, dest->parent_region, t);
                *c = *c + 1;
            }
        }
    }

    return err;
}

static void ufsm_load_history(struct ufsm_machine *m,
                              const struct ufsm_state *src,
                              const struct ufsm_state **dest)
{

    if (ufsm_state_is(src, UFSM_STATE_SHALLOW_HISTORY) ||
        ufsm_state_is(src, UFSM_STATE_DEEP_HISTORY))
    {
        if (m->r_data[src->parent_region->index].history) {
            *dest = m->r_data[src->parent_region->index].history;
        }
    }

}

static int ufsm_make_transition(struct ufsm_machine *m,
                                const struct ufsm_transition *t,
                                const struct ufsm_region *r)
{
    int err = UFSM_OK;
    const struct ufsm_state *dest = t->dest;
    const struct ufsm_state *src = NULL;
    const struct ufsm_region *act_region = r;
    const struct ufsm_transition *act_t = NULL;
    const struct ufsm_region *lca_region = NULL;
    int transition_count = 1;

    err = ufsm_push_rt_pair (m, r, t);

    if (err != UFSM_OK)
        return err;

    while (transition_count && (err == UFSM_OK))
    {
        err = ufsm_pop_rt_pair(m, &act_region, &act_t);

        if (err != UFSM_OK)
            break;

        transition_count--;

        src = act_t->source;
        dest = act_t->dest;

        ufsm_load_history(m, src, &dest);

        if (!ufsm_test_guards(m, act_t))
        {
            err = UFSM_ERROR_EVENT_NOT_PROCESSED;
            break;
        }

        if (m->s_data[act_t->source->index].cant_exit)
            continue;

        if (m->debug_transition)
            m->debug_transition(act_t);

        if (t->kind == UFSM_TRANSITION_EXTERNAL)
        {
            /* If we are in a composite state make sure to
             *  exit all nested states
             **/

            ufsm_leave_nested_states(m, src);
            ufsm_leave_state(m, act_t->source);

            /* For compound transitions parents must be exited and entered
             * in the correct order.
             * */
            err = ufsm_leave_parent_states(m, src, dest, &lca_region,
                                                             &act_region);
            if (err != UFSM_OK)
                break;
        }

        ufsm_execute_actions(m, act_t);

        if ((t->kind == UFSM_TRANSITION_EXTERNAL) &&
            (src->parent_region != dest->parent_region))
        {
            err = ufsm_enter_parent_states(m, lca_region, dest->parent_region);

            if (err != UFSM_OK)
                break;

        }

        /* Decode destination state kind */
        switch(dest->kind)
        {
            case UFSM_STATE_SHALLOW_HISTORY:
            case UFSM_STATE_DEEP_HISTORY:
            case UFSM_STATE_SIMPLE:
                ufsm_update_history(m, dest);
                m->r_data[act_region->index].current = (struct ufsm_state*) dest;
                if (t->kind == UFSM_TRANSITION_EXTERNAL)
                {
                    ufsm_enter_state(m, dest);
                    err = ufsm_process_regions(m, dest, &transition_count);
                }
            break;
            case UFSM_STATE_ENTRY_POINT:
            case UFSM_STATE_EXIT_POINT:
                err = ufsm_process_entry_exit_points(m,dest,&transition_count);
            break;
            case UFSM_STATE_FINAL:
                /* If all regions in this state have reached 'Final'
                 *  the superstate should exit if there is an anonymous
                 *  transition to a final state.
                 * */
                err = ufsm_process_final_state(m, act_region, dest,
                                                        &transition_count);
            break;
            case UFSM_STATE_FORK:
                err = ufsm_process_fork (m, act_region, dest,
                                                        &transition_count);
            break;
            case UFSM_STATE_JOIN:
                err = ufsm_process_join(m, act_region, src, dest,
                                                        &transition_count);
            break;
            case UFSM_STATE_CHOICE:
                err = ufsm_process_choice(m, act_region, dest,
                                                        &transition_count);
            break;
            case UFSM_STATE_JUNCTION:
                err = ufsm_process_junction(m, dest, &transition_count);
            break;
            case UFSM_STATE_TERMINATE:
                m->terminated = true;
                return UFSM_OK;
            break;
            default:
                err = UFSM_ERROR_UNKNOWN_STATE_KIND;
            break;
        }
    }

    return err;
}


static int ufsm_process_completion_events(struct ufsm_machine *m)
{
    int err = UFSM_OK;
    struct ufsm_state *completed_state;


    while (ufsm_stack_pop(&m->completion_stack,
                            (void **) &completed_state) == UFSM_OK)
    {
        err = ufsm_process_completion(m, completed_state);
        if (err != UFSM_OK)
            return err;
    }
    return err;
}

int ufsm_init_machine(struct ufsm_machine *m, void *context)
{
    int err = UFSM_OK;

    ufsm_stack_init(&(m->stack), UFSM_STACK_SIZE, m->stack_data);
    ufsm_stack_init(&(m->stack2), UFSM_STACK_SIZE, m->stack_data2);
    ufsm_stack_init(&(m->completion_stack),
                    UFSM_COMPLETION_STACK_SIZE, m->completion_stack_data);
    ufsm_queue_init(&(m->queue), UFSM_QUEUE_SIZE, m->queue_data);
    m->terminated = false;
    m->context = context;

    for (unsigned int n = 0; n < m->no_of_states; n++) {
        m->s_data[n].cant_exit = false;
    }

    for (unsigned int n = 0; n < m->no_of_regions; n++) {
        m->r_data[n].current = NULL;
        m->r_data[n].history = NULL;
    }

    for (const struct ufsm_region *r = m->region; r; r = r->next)
    {
        const struct ufsm_transition *rt = ufsm_get_first_state(r);

        err = ufsm_make_transition(m, rt, r);

        if (err != UFSM_OK)
            break;
    }

    if (err == UFSM_OK)
        err = ufsm_process_completion_events(m);

    return err;
}


static inline bool ufsm_transition_has_trigger(const struct ufsm_transition *t, int ev)
{
    if (t->trigger) {
        if (ev == t->trigger->trigger)
            return true;
    }
    return false;
}

static bool ufsm_transition(struct ufsm_machine *m, const struct ufsm_region *r,
                            int ev)
{
    bool event_consumed = false;
    struct ufsm_state *current_state = m->r_data[r->index].current;

    for (const struct ufsm_state *s = r->state; s; s = s->next) {
        for (const struct ufsm_transition *t = s->transition; t; t = t->next) {
            if (ufsm_transition_has_trigger(t, ev) && (t->source == current_state)) {
                int e = ufsm_make_transition(m, t, r);

                struct ufsm_region *r2 = (struct ufsm_region *) r;

                while (r2 && (ev != -1) && e == UFSM_OK) {
                    if (r2->parent_state) {
                        m->s_data[r2->parent_state->index].cant_exit = true;
                        r2 = (struct ufsm_region *) r2->parent_state->parent_region;
                    }
                    else
                        r2 = NULL;
                }

                event_consumed = true;

                if (e == UFSM_OK) {
                    if (!r->next)
                        break;
                }

            }
        }
    }

    return event_consumed;
}


int ufsm_process (struct ufsm_machine *m, int ev)
{
    int err = UFSM_OK;
    int region_count = 0;
    struct ufsm_region *region = NULL;
    struct ufsm_state *s = NULL;
    bool event_consumed = false;

    if (m->terminated)
        return UFSM_ERROR_MACHINE_TERMINATED;

    ufsm_process_completion_events(m);

    if (ev == -1)
        return UFSM_OK;

    if (m->debug_event)
        m->debug_event(ev);

    ufsm_find_active_regions(m,m->region, &region_count);

    for (int i = 0; i < region_count; i++)
    {
        err = ufsm_pop_sr_pair(m, &region, &s);

        if (err != UFSM_OK)
            break;

        /* First ensure that the active state has not
         * changed
         * */
        if (m->r_data[region->index].current == s)
        {
            if (ufsm_transition (m, region, ev))
                event_consumed = true;
        }
    }

    if (!event_consumed && err == UFSM_OK)
        err = UFSM_ERROR_EVENT_NOT_PROCESSED;

    return err;
}

static int ufsm_reset_region(struct ufsm_machine *m,
                             const struct ufsm_region *regions)
{
    int err = UFSM_OK;
    const struct ufsm_region *r = NULL;

    err = ufsm_stack_push(&m->stack, (void *) regions);

    if (err != UFSM_OK)
        return err;

    while (ufsm_stack_pop(&m->stack,(void **) &r) == UFSM_OK) {
        m->r_data[r->index].history = NULL;
        m->r_data[r->index].current = NULL;

        for (const struct ufsm_state *s = r->state; s; s = s->next) {
            for (const struct ufsm_region *sr = s->region; sr; sr = sr->next) {
                err = ufsm_stack_push(&m->stack, (void *) sr);

                if (err != UFSM_OK) {
                    goto err_out;
                }
            }
        }
    }

err_out:
    return err;
}

int ufsm_reset_machine(struct ufsm_machine *m)
{
    if (m->debug_reset)
        m->debug_reset(m);

    for (const struct ufsm_region *r = m->region; r; r = r->next)
        ufsm_reset_region(m, r);

    return UFSM_OK;
}

struct ufsm_queue * ufsm_get_queue(struct ufsm_machine *m)
{
    return &m->queue;
}
