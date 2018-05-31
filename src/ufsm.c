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
};


static struct ufsm_transition * ufsm_get_first_state (
                        struct ufsm_region *region)
{
   
    for (struct ufsm_state *s = region->state; s; s = s->next) 
    {
        if (s->kind == UFSM_STATE_INIT || 
            s->kind == UFSM_STATE_SHALLOW_HISTORY ||
            s->kind == UFSM_STATE_DEEP_HISTORY) 
        {

            for (struct ufsm_transition *t = region->transition;t;t = t->next) 
            {
                if (t->source == s)
                    return t;
                
            }
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
 
    err = ufsm_stack_push(&m->stack, r);

    if (err != UFSM_OK)
        return err;
    c++;

    while (ps && r != ancestor)
    {
        pr = ps->parent_region;
        if (pr == NULL)
            break;

        if (pr == ancestor)
            break;

        err = ufsm_stack_push(&m->stack, pr);

        if (err != UFSM_OK)
            return err;

        c++;

        ps = pr->parent_state;
    }

    for (uint32_t i = 0; i < c; i++)
    {
        err = ufsm_stack_pop(&m->stack, (void **) &pr);
        
        if (err != UFSM_OK)
            return err;

        if (m->debug_enter_region)
            m->debug_enter_region(pr);

        ps = pr->parent_state;
        
        if (!ps)
            continue;

        if (ps->parent_region)
            ps->parent_region->current = ps;

        if (pr != ancestor) {
            if (m->debug_enter_state)
                m->debug_enter_state(ps);

            for (struct ufsm_entry_exit *e = ps->entry; e; e = e->next)
                e->f();
        }
    }
    
    return UFSM_OK;
}

static uint32_t ufsm_leave_parent_states(struct ufsm_machine *m,
                                          struct ufsm_region *ancestor,
                                          struct ufsm_region *r)
{
    struct ufsm_entry_exit *e = NULL;
    struct ufsm_region *rl = r;
    bool states_to_leave = true;

    while (states_to_leave) {
        if (ancestor == rl)
            return UFSM_OK;

        if (m->debug_leave_region)
            m->debug_leave_region(rl);
     
        if (rl->parent_state) {
            if (m->debug_exit_state)
                m->debug_exit_state(rl->parent_state);

           e = rl->parent_state->exit;
        }
        
        rl->current = NULL;

        for (;e; e = e->next)
            e->f();

        if (rl->parent_state) {
            if (rl->parent_state->parent_region) {
                rl = rl->parent_state->parent_region;
                e = NULL;
                states_to_leave = true;
            }
        } else {
            states_to_leave = false;
        }
        
    }
    return UFSM_OK;
}

static struct ufsm_region * ufsm_least_common_ancestor(struct ufsm_region *r1,
                                                      struct ufsm_region *r2)
{
    struct ufsm_region *lca = r1;
    struct ufsm_region *lca2 = r2;

    while (lca) {
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

static uint32_t ufsm_leave_nested_states(struct ufsm_machine *m,
                                        struct ufsm_region *regions)
{
    struct ufsm_region *r = regions;
    uint32_t c = 0;
    uint32_t err = UFSM_OK;

    do {
        c++;
        err = ufsm_stack_push(&m->stack, r);
        if (err != UFSM_OK)
            return err;
        if (r->current)
            r = r->current->region;
        else
            r = NULL;
    } while (r);

    for (uint32_t i = 0; i < c; i++) { 
        err = ufsm_stack_pop(&m->stack, (void **) &r);
        if (err != UFSM_OK)
            return err;

        if (r->current) {
            if (m->debug_exit_state)
                m->debug_exit_state(r->current);

            for (struct ufsm_entry_exit *e = r->current->exit; e; e = e->next)
                e->f();
            if (r->has_history)
                r->history = r->current;
            r->current = NULL;
        }
    }
    return UFSM_OK;
}

static uint32_t ufsm_init_region_history(struct ufsm_machine *m,
                                struct ufsm_region *regions) 
{
    if (regions->has_history && regions->history) {
        regions->current = regions->history;
        if (m->debug_enter_region)
            m->debug_enter_region(regions);

        if (m->debug_enter_state)
            m->debug_enter_state(regions->current);


        for (struct ufsm_entry_exit *f = regions->current->entry; 
                                                            f; f = f->next)
            f->f();

        return UFSM_OK;
    }

    return UFSM_ERROR_NO_INIT_REGION;
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


    err = ufsm_stack_push(&m->stack, r);
    if (err != UFSM_OK)
        return err;
    err = ufsm_stack_push(&m->stack, t);
    if (err != UFSM_OK)
        return err;

    while (transition_count)
    {
        err = ufsm_stack_pop(&m->stack, (void **) &act_t);
        if (err != UFSM_OK)
            return err;
 
        err = ufsm_stack_pop(&m->stack, (void **) &act_region);
        if (err != UFSM_OK)
            return err;
        
        transition_count--;

        src = act_t->source;
        dest = act_t->dest;

        /* When H state entered implicitly through region initialisation */
        if (src->kind == UFSM_STATE_SHALLOW_HISTORY ||
            src->kind == UFSM_STATE_DEEP_HISTORY) 
        {
            if (src->parent_region->history)
                dest = src->parent_region->history;
        }

        /* Check all guards */
        for (struct ufsm_guard *g = act_t->guard; g; g = g->next) 
        {
            bool guard_ok = g->f();
            if (m->debug_guard)
                m->debug_guard(g, guard_ok);
            if (!guard_ok)
                return UFSM_ERROR_EVENT_NOT_PROCESSED;
        }

        if (m->debug_transition)
            m->debug_transition(act_t);

        /* If we are in a composite state make sure to exit all nested states */
        if (src->region)
            if (src->region->current) {
                err = ufsm_leave_nested_states(m, src->region);
                if (err != UFSM_OK)
                    return err;
            }

        if (m->debug_exit_state)
            m->debug_exit_state(act_t->source);


        /* Call exit functions in previous state */
        if (act_t->kind == UFSM_TRANSITION_EXTERNAL) 
            for (struct ufsm_entry_exit *f = src->exit; f; f = f->next)
                f->f();

        /* For compound transitions parents must be exited and entered
         * in the correct order.
         * */
        if ( (src->parent_region != dest->parent_region) &&
                dest->kind != UFSM_STATE_JOIN) {
            act_region = dest->parent_region;
            lca_region = ufsm_least_common_ancestor(src->parent_region,
                                                    dest->parent_region);
            if (!lca_region) 
                return UFSM_ERROR_LCA_NOT_FOUND;

            err = ufsm_leave_parent_states(m, lca_region, src->parent_region);
            if (err != UFSM_OK)
                return err;
        }
        
        for (struct ufsm_action *a = act_t->action; a; a = a->next) {
            if (m->debug_action)
                m->debug_action(a);
            a->f();
        }

        if (lca_region) {
            err = ufsm_enter_parent_states(m, lca_region, dest->parent_region);

            if (err != UFSM_OK)
                return err;
        }
                
        bool super_exit = false;
        bool exec_join = false;

        /* Decode destination state kind */
        switch(dest->kind) {
            case UFSM_STATE_SHALLOW_HISTORY:
            case UFSM_STATE_DEEP_HISTORY:
                if (act_region->history)
                    dest = act_region->history;
            case UFSM_STATE_SIMPLE:
                /* Update current state */
                if (dest->parent_region) 
                    if (dest->parent_region->has_history)
                        dest->parent_region->history = dest;

                act_region->current = dest;

                if (dest->submachine) {
                    ufsm_stack_init(&(m->stack), UFSM_STACK_SIZE, m->stack_data);

                    struct ufsm_transition *init_t = 
                            ufsm_get_first_state(dest->submachine->region);

                    if (init_t == NULL) {
                        err = ufsm_init_region_history(m, dest->submachine->region);
                        if (err != UFSM_OK)
                            return err;
                    } else {
                        err = ufsm_stack_push (&m->stack, dest->submachine->region);
                        if (err != UFSM_OK)
                            return err;
                        err = ufsm_stack_push (&m->stack, init_t);
                        if (err != UFSM_OK)
                            return err;

                        transition_count++;
                    }
 
                } else {
                    if (m->debug_enter_state)
                        m->debug_enter_state(dest);

                    /* Call entry functions in new state */
                    if (t->kind == UFSM_TRANSITION_EXTERNAL) {
                        for (struct ufsm_entry_exit *f = dest->entry; f; f = f->next)
                            f->f();
                    }
                    for (struct ufsm_region *s_r = dest->region; s_r; s_r = s_r->next) {
                        struct ufsm_transition *init_t = ufsm_get_first_state(s_r);

                        if (init_t == NULL) {
                            err = ufsm_init_region_history(m, s_r);
                            if (err != UFSM_OK)
                                return err;
                        } else {
                            err = ufsm_stack_push (&m->stack, s_r);
                            if (err != UFSM_OK)
                                return err;
                            err = ufsm_stack_push (&m->stack, init_t);
                            if (err != UFSM_OK)
                                return err;

                            transition_count++;
                        }
                    }
                }
            break;
            case UFSM_STATE_ENTRY_POINT:
            case UFSM_STATE_EXIT_POINT:
                for (struct ufsm_transition *te = dest->parent_region->transition;
                                                              te; te = te->next) 
                {
                    if (te->source == dest) {
                        err = ufsm_stack_push(&m->stack, 
                                            te->dest->parent_region);
                        if (err != UFSM_OK)
                            return err;

                        err = ufsm_stack_push(&m->stack, te);

                        if (err != UFSM_OK)
                            return err;

                        transition_count++;
                    }
                }
            break;
            case UFSM_STATE_FINAL:
                /* If all regions in this state have reached 'Final' 
                 *  the superstate should exit if there is an anonymous
                 *  transition to a final state.
                 * */
                act_region->current = dest;
                if (dest->kind == UFSM_STATE_FINAL && 
                                                act_region->parent_state) {
                    super_exit = true;
                    for (struct ufsm_region *ar = 
                         act_region->parent_state->region; ar; ar = ar->next) {
                        if (ar->current) {
                            if (ar->current->kind != UFSM_STATE_FINAL)
                                super_exit = false;
                        }
                    }
                }

                if (super_exit && act_region->parent_state) {
                    for (struct ufsm_region *ar = act_region->parent_state->region; 
                                                                    ar; ar = ar->next) {
                        if (ar->current) {
                            if (m->debug_exit_state)
                                m->debug_exit_state(ar->current);
                            for (struct ufsm_entry_exit *f = ar->current->exit;
                                                               f; f = f->next) {
                                f->f();
                            }
                        }
                    }
             
                    for (struct ufsm_transition *tf = 
                                act_region->parent_state->parent_region->transition; 
                                tf; tf = tf->next) 
                    {
                        if (tf->dest->kind == UFSM_STATE_FINAL &&
                            tf->source == act_region->parent_state) {

                            err = ufsm_stack_push(&m->stack, 
                                    act_region->parent_state->parent_region);
                            if (err != UFSM_OK)
                                return err;
                            err = ufsm_stack_push(&m->stack, tf);
                            if (err != UFSM_OK)
                                return err;

                            transition_count++;
                        }
                    }
                }
 
            break;
            case UFSM_STATE_FORK:
                for (struct ufsm_transition *tf = r->transition; tf; tf = tf->next)
                {
                    if (tf->source == dest) 
                    {
                        err = ufsm_stack_push(&m->stack, act_region);

                        if (err != UFSM_OK)
                            return err;

                        err = ufsm_stack_push(&m->stack, tf);

                        if (err != UFSM_OK)
                            return err;

                        transition_count++;
                    }
                }
            break;
            case UFSM_STATE_JOIN:
                exec_join = true;
                src->parent_region->current = dest;
                for (struct ufsm_region *dr = 
                    src->parent_region->parent_state->region;dr;dr = dr->next){
                    if (dr->current != dest)
                        exec_join = false;
                }

                if (exec_join) {
                    for (struct ufsm_transition *dt = dest->parent_region->transition;
                                            dt; dt = dt->next) 
                    {
                        if (dt->source == dest) {
                            err = ufsm_stack_push(&m->stack, act_region);
                            if (err != UFSM_OK)
                                return err;
                            err = ufsm_stack_push(&m->stack, dt);
                            if (err != UFSM_OK)
                                return err;
                            transition_count++;
                        }
                    }
                }
            break;
            default:
                return UFSM_ERROR_UNKNOWN_STATE_KIND;
            break;
        }
    }

    return UFSM_OK;
}

uint32_t ufsm_init_machine(struct ufsm_machine *m) 
{
    uint32_t err = UFSM_OK;
    
    ufsm_stack_init(&(m->stack), UFSM_STACK_SIZE, m->stack_data);

    for (struct ufsm_region *r = m->region; r; r = r->next) {
        struct ufsm_transition *rt = ufsm_get_first_state(r);
        
        if (rt == NULL) {
            err = ufsm_init_region_history(m, r);

            if (err != UFSM_OK)
                return err;
        } else {
            err = ufsm_make_transition(m, rt, r);
            if (err != UFSM_OK)
                return err;
        }
    }

    return UFSM_OK;
}

uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev) 
{
    struct ufsm_region *r = m->region;
    struct ufsm_state *s = NULL;
    bool events_processed = false;
    uint32_t err = UFSM_OK;
    uint32_t state_count = 0;

    if (m->debug_event)
        m->debug_event(ev);
    
    while (r) {
        s = r->current;

        if (s) {
            if (s->kind == UFSM_STATE_SIMPLE) {
                err = ufsm_stack_push(&m->stack, s);
                if (err != UFSM_OK)
                    return err;
                state_count++;

                if (s->region) {
                    r = s->region;
                } else if (s->submachine) {
                    r = s->submachine->region;
                } else if (s->parent_region) {
                    r = s->parent_region->next;
                } else if (r->parent_state) {
                    r = r->parent_state->region->next;
                }
            } else {
                r = r->next;
            }
        } else {
            r = r->next;
        } 
    }

    bool all_transitions_done = false;
    for (uint32_t i = 0; i < state_count; i++) {
        err = ufsm_stack_pop(&m->stack, (void **) &s);
        if (err != UFSM_OK)
            return err;
        r = s->parent_region;

        if (all_transitions_done)
            continue;

        for (struct ufsm_transition *t = r->transition; t; t = t->next) {

            if (t->trigger == ev && t->source == r->current) {
                events_processed = true;
                err = ufsm_make_transition(m, t, r);

                if (err == UFSM_OK) 
                {
                    struct ufsm_region *dr = t->dest->parent_region;
                    if (dr) {
                        if (dr->parent_state) {
                            if (dr->parent_state->region) {
                                if (dr->parent_state->region->next == NULL)
                                    all_transitions_done = true;
                            }
                        }
                    }
                    break;
                }
            }
        }
    
    }

    return events_processed ? UFSM_OK : UFSM_ERROR_EVENT_NOT_PROCESSED;
}

static uint32_t ufsm_reset_region(struct ufsm_machine *m,
                                struct ufsm_region *regions)
{
    uint32_t err = UFSM_OK;
    struct ufsm_region *r = NULL;
    uint32_t regions_count = 1;
    
    err = ufsm_stack_push(&m->stack, regions);
    if (err != UFSM_OK)
        return err;
  
    while (regions_count) {
        
        err = ufsm_stack_pop(&m->stack, (void **) &r);
        
        if (err != UFSM_OK)
            return err;

        r->history = NULL;
        r->current = NULL;
     
        for (struct ufsm_state *s = r->state; s; s = s->next) {
            for (struct ufsm_region *sr = s->region; sr; sr = sr->next) 
            {
                if (sr) {
                    err = ufsm_stack_push(&m->stack, sr);
                    if (err != UFSM_OK)
                        return err;

                    regions_count++;
                }
            }
            if (s->submachine) {
                for (struct ufsm_region *sr = s->submachine->region 
                                                ; sr; sr = sr->next) 
                {
                    if (sr) {
                        err = ufsm_stack_push(&m->stack, sr);
                        if (err != UFSM_OK)
                            return err;

                        regions_count++;
                    }
                }
            }
        }
        
    }
    return UFSM_OK;
}

uint32_t ufsm_reset_machine(struct ufsm_machine *m)
{
    for (struct ufsm_region *r = m->region; r; r = r->next)
        ufsm_reset_region(m, r);

    return UFSM_OK;
}
