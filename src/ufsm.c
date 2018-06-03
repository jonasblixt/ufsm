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

static bool ufsm_state_is(struct ufsm_state *s, uint32_t kind)
{
    return s ? (s->kind == kind) : false;
}

static void ufsm_enter_state(struct ufsm_machine *m, struct ufsm_state *s)
{
    if (m->debug_enter_state)
        m->debug_enter_state(s);

    for (struct ufsm_entry_exit *e = s->entry; e; e = e->next)
        e->f();
}

static void ufsm_leave_state(struct ufsm_machine *m, struct ufsm_state *s)
{
    if (m->debug_exit_state)
        m->debug_exit_state(s);

    for (struct ufsm_entry_exit *e = s->exit; e; e = e->next)
        e->f();
}


static void ufsm_set_current_state(struct ufsm_machine *m,
                                   struct ufsm_region *r,
                                   struct ufsm_state *s)
{
    if (r)
        r->current = s;
}

static struct ufsm_transition *ufsm_find_transition(struct ufsm_region *region,
                                                     struct ufsm_state *source,
                                                     struct ufsm_state *dest)
{
    for (struct ufsm_transition *t = region->transition; t; t = t->next)
    {
        if ( (t->source == source && dest == NULL)    ||
             (t->source == source && t->dest == dest) ||
             (t->dest == dest && source == NULL)) {
             return t;
        }
    }

    return NULL;
}

static bool ufsm_test_guards(struct ufsm_machine *m,
                             struct ufsm_transition *t)
{
    bool result = true;

    for (struct ufsm_guard *g = t->guard; g; g = g->next) 
    {
        bool guard_result = g->f();

        if (m->debug_guard)
            m->debug_guard(g, guard_result);

        if (!guard_result)
            result = false;
    }

    return result;
}

static void ufsm_execute_actions(struct ufsm_machine *m,
                                 struct ufsm_transition *t)
{
    for (struct ufsm_action *a = t->action; a; a = a->next) 
    {
        if (m->debug_action)
            m->debug_action(a);
        a->f();
    }
}

static void ufsm_recover_history(struct ufsm_region *r,
                                 struct ufsm_state **sp)
{
    if (r->has_history)
        *sp = r->history;
}

static void ufsm_update_history(struct ufsm_state *s)
{
    if (s->parent_region) 
        if (s->parent_region->has_history)
            s->parent_region->history = s;
}

static struct ufsm_transition * ufsm_get_first_state (
                        struct ufsm_region *region)
{
   
    for (struct ufsm_state *s = region->state; s; s = s->next) 
    {
        if (ufsm_state_is(s, UFSM_STATE_INIT) || 
            ufsm_state_is(s, UFSM_STATE_SHALLOW_HISTORY) ||
            ufsm_state_is(s, UFSM_STATE_DEEP_HISTORY)) 
        {
            return ufsm_find_transition (region, s, NULL);
        }
    }

    return NULL;
}

static uint32_t ufsm_enter_parent_states(struct ufsm_machine *m,
                                          struct ufsm_region *ancestor,
                                          struct ufsm_region *r)
{
    uint32_t err = UFSM_OK;
    uint32_t c = 0;

    struct ufsm_state *ps = r->parent_state;
    struct ufsm_region *pr = NULL;
 
    if (!ancestor)
        return UFSM_OK;

    err = ufsm_stack_push(&m->stack, r);
    c++;

    while (ps && r != ancestor && err == UFSM_OK)
    {
        pr = ps->parent_region;

        if (pr == ancestor || pr == NULL)
            break;

        err = ufsm_stack_push(&m->stack, pr);

        c++;

        ps = pr->parent_state;
    }

    for (uint32_t i = 0; i < c; i++)
    {
        err = ufsm_stack_pop(&m->stack, (void **) &pr);

        if (err != UFSM_OK)
            break;

        if (m->debug_enter_region)
            m->debug_enter_region(pr);

        ps = pr->parent_state;
        
        if (ps) {
            ufsm_set_current_state (m, ps->parent_region, ps);

            if (pr != ancestor)
                ufsm_enter_state(m, ps);            
        }
    }
    
    return err;
}

static struct ufsm_region * ufsm_least_common_ancestor(struct ufsm_machine *m,
                                                       struct ufsm_region *r1,
                                                       struct ufsm_region *r2)
{
    struct ufsm_region *lca = r1;
    struct ufsm_region *lca2 = r2;

    while (lca) 
    {
        lca2 = r2;
        do {
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

static uint32_t ufsm_leave_parent_states(struct ufsm_machine *m,
                                          struct ufsm_state *src,
                                          struct ufsm_state *dest,
                                          struct ufsm_region **lca,
                                          struct ufsm_region **act)
{
    struct ufsm_region *rl = NULL;
    struct ufsm_region *ancestor = NULL;
    bool states_to_leave = true;

    if ( !((src->parent_region != dest->parent_region) &&
            dest->kind != UFSM_STATE_JOIN))
        return UFSM_OK;

    *act = dest->parent_region;
    rl = src->parent_region;

    ancestor = ufsm_least_common_ancestor(m, src->parent_region,
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
        
        if (rl->parent_state) {
            ufsm_leave_state(m, rl->parent_state); 
            rl->current = NULL;

            if (rl->parent_state->parent_region) {
                rl = rl->parent_state->parent_region;
                states_to_leave = true;
            }
        } else {
            states_to_leave = false;
        }
        
    }

    return UFSM_OK;
}
 
static uint32_t ufsm_leave_nested_states(struct ufsm_machine *m,
                                        struct ufsm_state *s)
{
    struct ufsm_region *r = NULL;
    uint32_t c = 0;
    uint32_t err = UFSM_OK;

    if (!s->region || !s->region->current)
        return UFSM_OK;

    r = s->region;

    do {
        c++;
        err = ufsm_stack_push(&m->stack, r);
        if (err != UFSM_OK)
            break;
        if (r->current)
            r = r->current->region;
        else
            r = NULL;
    } while (r);

    for (uint32_t i = 0; i < c; i++) { 
        err = ufsm_stack_pop(&m->stack, (void **) &r);

        if (err != UFSM_OK)
            break;

        if (r->current) {

            ufsm_leave_state(m, r->current);

            if (r->has_history)
                r->history = r->current;
            r->current = NULL;
        }
    }
    return err;
}

static uint32_t ufsm_init_region_history(struct ufsm_machine *m,
                                struct ufsm_region *regions) 
{
    uint32_t err = UFSM_ERROR_NO_INIT_REGION;

    if (regions->has_history && regions->history) {
        regions->current = regions->history;
        if (m->debug_enter_region)
            m->debug_enter_region(regions);

        ufsm_enter_state(m, regions->current);
        err = UFSM_OK;
    }

    return err;
}


static uint32_t ufsm_push_rt_pair(struct ufsm_machine *m,
                                  struct ufsm_region *r,
                                  struct ufsm_transition *t)
{
    uint32_t err = UFSM_OK;

    err = ufsm_stack_push (&m->stack, r);
    
    if (err == UFSM_OK)
        err = ufsm_stack_push (&m->stack, t);

    return err;
}

static uint32_t ufsm_pop_rt_pair(struct ufsm_machine *m,
                                  struct ufsm_region **r,
                                  struct ufsm_transition **t)
{
    uint32_t err = UFSM_OK;

    err = ufsm_stack_pop (&m->stack, (void **) t);
    
    if (err == UFSM_OK)
        err = ufsm_stack_pop (&m->stack, (void **) r);

    return err;
}

static uint32_t ufsm_process_regions(struct ufsm_machine *m,
                                     struct ufsm_state *dest,
                                     uint32_t *c)
{
    uint32_t err = UFSM_OK;
    struct ufsm_region *r = dest->region;

    for (struct ufsm_region *s_r = r; s_r && err == UFSM_OK; s_r = s_r->next) 
    {
        struct ufsm_transition *init_t = ufsm_get_first_state(s_r);

        if (init_t == NULL) {
            err = ufsm_init_region_history(m, s_r);
        } else {
            err = ufsm_push_rt_pair(m, s_r, init_t);
            *c = *c + 1;
        }
    }

    return err;
}

static uint32_t ufsm_process_entry_exit_points(struct ufsm_machine *m,
                                               struct ufsm_state *dest,
                                               uint32_t *c)
{
    uint32_t err = UFSM_OK;

    for (struct ufsm_transition *te = dest->parent_region->transition;
                                    te && err == UFSM_OK; te = te->next) 
    {
        if (te->source == dest) {
            err = ufsm_push_rt_pair(m, te->dest->parent_region, te);
            *c = *c + 1;
        }
    }
    
    return err;
}

static uint32_t ufsm_process_final_state(struct ufsm_machine *m,
                                         struct ufsm_region *act_region,
                                         struct ufsm_state *dest,
                                         uint32_t *c)
{
    uint32_t err = UFSM_OK;
    bool super_exit = false;

    act_region->current = dest;
    if (dest->kind == UFSM_STATE_FINAL && act_region->parent_state) 
    {
        super_exit = true;
        for (struct ufsm_region *ar = act_region->parent_state->region; 
                                                    ar; ar = ar->next) 
        {
            if (ar->current) {
                if (ar->current->kind != UFSM_STATE_FINAL)
                    super_exit = false;
            }
        }
    }

    if (super_exit && act_region->parent_state) 
    {
        for (struct ufsm_region *ar = act_region->parent_state->region; 
                                                        ar; ar = ar->next) 
        {
            ufsm_leave_state(m, ar->current);
        }
 
        for (struct ufsm_transition *tf = 
                    act_region->parent_state->parent_region->transition; 
                    tf && err == UFSM_OK; tf = tf->next) 
        {
            if (tf->dest->kind == UFSM_STATE_FINAL &&
                tf->source == act_region->parent_state) 
            {

                err = ufsm_push_rt_pair(m, 
                    act_region->parent_state->parent_region, tf);

                *c = *c + 1;
            }
        }
    }
 
    return err;
}

static uint32_t ufsm_process_fork(struct ufsm_machine *m,
                                  struct ufsm_region *act_region,
                                  struct ufsm_state *dest,
                                  uint32_t *c)
{
    uint32_t err = UFSM_OK;

    for (struct ufsm_transition *tf = act_region->transition; 
                            tf && err == UFSM_OK; tf = tf->next)
    {
        if (tf->source == dest) 
        {
            err = ufsm_push_rt_pair(m, act_region, tf);
            *c = *c + 1;
        }
    }

    return err;
}

static uint32_t ufsm_process_join(struct ufsm_machine *m,
                                  struct ufsm_region *act_region,
                                  struct ufsm_state *src,
                                  struct ufsm_state *dest,
                                  uint32_t *c)
{
    bool exec_join = true;
    uint32_t err = UFSM_OK;

    src->parent_region->current = dest;
    for (struct ufsm_region *dr = src->parent_region->parent_state->region;
                                                    dr;dr = dr->next)
    {
        if (dr->current != dest)
            exec_join = false;
    }

    if (exec_join) {
        for (struct ufsm_transition *dt = dest->parent_region->transition;
                                dt && err == UFSM_OK; dt = dt->next) 
        {
            if (dt->source == dest) 
            {
                err = ufsm_push_rt_pair(m, act_region, dt);
                *c = *c + 1;
            }
        }
    }
    
    return err;
}

static uint32_t ufsm_process_choice(struct ufsm_machine *m,
                                    struct ufsm_region *act_region,
                                    struct ufsm_state *dest,
                                    uint32_t *c)
{
    uint32_t err = UFSM_OK;

    for (struct ufsm_transition *dt = dest->parent_region->transition;
                                    dt && err == UFSM_OK; dt = dt->next)
    {
        if ( dt->source == dest)
        {
            if (ufsm_test_guards(m, dt)) {
                err = ufsm_push_rt_pair(m, act_region, dt);
                *c = *c + 1;
            }
        }
    }

    return err;
}

static uint32_t ufsm_process_junction(struct ufsm_machine *m,
                                      struct ufsm_state *dest,
                                      uint32_t *c)
{
    uint32_t err = UFSM_OK;

    for (struct ufsm_transition *t = dest->parent_region->transition; 
                                                            t; t = t->next) 
    {
        if (t->source == dest)
        {
            err = ufsm_push_rt_pair(m, dest->parent_region, t);
            *c = *c + 1;
        }
    }

    return err;
}

void ufsm_update_defer_queue(struct ufsm_machine *m,
                              uint32_t ev)
{
    uint32_t err = UFSM_OK;

    do {
        err = ufsm_queue_get(&m->defer_queue, &ev);
        if (err == UFSM_OK)
            err = ufsm_queue_put(&m->queue, ev);
    } while(err == UFSM_OK);


}

static void ufsm_load_history(struct ufsm_state *src,
                              struct ufsm_state **dest)
{

    if (ufsm_state_is(src, UFSM_STATE_SHALLOW_HISTORY) ||
        ufsm_state_is(src, UFSM_STATE_DEEP_HISTORY))
    {
        if (src->parent_region->history)
            *dest = src->parent_region->history;
    }

}

static uint32_t ufsm_make_transition(struct ufsm_machine *m,
                                     struct ufsm_transition *t,
                                     struct ufsm_region *r)
{
    uint32_t err = UFSM_OK;
    struct ufsm_state *dest = t->dest;
    struct ufsm_state *src = t->source;
    struct ufsm_region *act_region = r;
    struct ufsm_transition *act_t = NULL;
    struct ufsm_region *lca_region = NULL;
    uint32_t transition_count = 1;
    uint32_t ev = 0;

    ufsm_update_defer_queue(m, ev);

    err = ufsm_push_rt_pair (m, r, t);

    while (transition_count && err == UFSM_OK)
    {
        err = ufsm_pop_rt_pair(m, &act_region, &act_t);

        if (err != UFSM_OK)
            break;
 
        transition_count--;

        src = act_t->source;
        dest = act_t->dest;

        if (t->defer) {
            err = ufsm_queue_put(&m->defer_queue, ev);
        
            if (err != UFSM_OK)
                break;

            continue;
        }

        ufsm_load_history(src, &dest);

        if (!ufsm_test_guards(m, act_t)) {
            err = UFSM_ERROR_EVENT_NOT_PROCESSED;
            break;
        }

        if (m->debug_transition)
            m->debug_transition(act_t);

        if (t->kind == UFSM_TRANSITION_EXTERNAL)
        {
            /* If we are in a composite state make sure to exit all nested states */
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

        if (t->kind == UFSM_TRANSITION_EXTERNAL &&
            src->parent_region != dest->parent_region) 
        {
            err = ufsm_enter_parent_states(m, lca_region, dest->parent_region);

            if (err != UFSM_OK)
                break;

        }

        /* Decode destination state kind */
        switch(dest->kind) {
            case UFSM_STATE_SHALLOW_HISTORY:
            case UFSM_STATE_DEEP_HISTORY:
                ufsm_recover_history(act_region, &dest);
            case UFSM_STATE_SIMPLE:
                ufsm_update_history(dest);
                act_region->current = dest;
                if (t->kind == UFSM_TRANSITION_EXTERNAL) {
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
                err  = ufsm_process_join(m, act_region, src, dest, 
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

uint32_t ufsm_init_machine(struct ufsm_machine *m) 
{
    uint32_t err = UFSM_OK;
    
    ufsm_stack_init(&(m->stack), UFSM_STACK_SIZE, m->stack_data);
    ufsm_queue_init(&(m->queue), UFSM_QUEUE_SIZE, m->queue_data);
    ufsm_queue_init(&(m->defer_queue), UFSM_DEFER_QUEUE_SIZE, m->defer_queue_data);
    m->terminated = false;

    for (struct ufsm_region *r = m->region; r && err == UFSM_OK; r = r->next) 
    {
        struct ufsm_transition *rt = ufsm_get_first_state(r);
        
        if (rt == NULL) {
            err = ufsm_init_region_history(m, r);
        } else {
            err = ufsm_make_transition(m, rt, r);
        }
    }

    return err;
}

uint32_t ufsm_find_active_states(struct ufsm_machine *m, uint32_t *c)
{
    uint32_t err = UFSM_OK;
    struct ufsm_region *r = m->region;
    struct ufsm_state *s = NULL;
 
    while (r) 
    {
        s = r->current;

        if (ufsm_state_is(s, UFSM_STATE_SIMPLE)) 
        {
            err = ufsm_stack_push(&m->stack, s);
            if (err != UFSM_OK)
                break;
            
            *c = *c + 1;

            if (s->region) {
                r = s->region;
            } else if (s->parent_region) {
                r = s->parent_region->next;
            } else if (r->parent_state) {
                r = r->parent_state->region->next;
            }
        } else {
            r = r->next;
        } 
    }

    return err;
}

bool ufsm_all_transitions_done(struct ufsm_region *dr)
{
    bool result = false;

    if (dr) 
    {
        if (dr->parent_state) 
        {
            if (dr->parent_state->region) 
            {
                if (dr->parent_state->region->next == NULL)
                    result = true;
            }
        }
    }

    return result;
}

uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev) 
{
    struct ufsm_region *r = NULL;
    struct ufsm_state *s = NULL;
    bool events_processed = false;
    uint32_t err = UFSM_OK;
    uint32_t state_count = 0;

    if (m->terminated)
        return UFSM_ERROR_MACHINE_TERMINATED;

    if (m->debug_event)
        m->debug_event(ev);
   
    ufsm_find_active_states(m, &state_count);

    bool all_transitions_done = false;

    for (uint32_t i = 0; i < state_count; i++) 
    {
        err = ufsm_stack_pop(&m->stack, (void **) &s);
        if (err != UFSM_OK)
            break;

        r = s->parent_region;

        if (!all_transitions_done)
        {
            for (struct ufsm_transition *t = r->transition; t; t = t->next) 
            {

                if (t->trigger == ev && t->source == r->current) 
                {
                    events_processed = true;
                    uint32_t e = ufsm_make_transition(m, t, r);
                    if (e == UFSM_OK) 
                    {
                        struct ufsm_region *dr = t->dest->parent_region;
                        all_transitions_done = ufsm_all_transitions_done(dr);
                        break;
                    } else if (e != UFSM_ERROR_EVENT_NOT_PROCESSED) {
                        err = e;
                    }
                }
            }
        }
    
    }

    if (!events_processed && err == UFSM_OK)
        err = UFSM_ERROR_EVENT_NOT_PROCESSED;

    return err;
}

static uint32_t ufsm_reset_region(struct ufsm_machine *m,
                                struct ufsm_region *regions)
{
    uint32_t err = UFSM_OK;
    struct ufsm_region *r = NULL;
    uint32_t regions_count = 1;
    
    err = ufsm_stack_push(&m->stack, regions);

    while (regions_count && err != UFSM_OK) 
    {
        
        err = ufsm_stack_pop(&m->stack, (void **) &r);
        
        if (err != UFSM_OK)
            break;

        r->history = NULL;
        r->current = NULL;
     
        for (struct ufsm_state *s = r->state; s && (err == UFSM_OK); 
                                                                s = s->next)
        {
            for (struct ufsm_region *sr = s->region; sr && err == UFSM_OK; 
                                                                sr = sr->next) 
            {
                if (sr) 
                {
                    err = ufsm_stack_push(&m->stack, sr);
                    regions_count++;
                }
            }
        }
        
    }
    return err;
}

uint32_t ufsm_reset_machine(struct ufsm_machine *m)
{
    for (struct ufsm_region *r = m->region; r; r = r->next)
        ufsm_reset_region(m, r);

    return UFSM_OK;
}

struct ufsm_queue * ufsm_get_queue(struct ufsm_machine *m)
{
    return &m->queue;
}
