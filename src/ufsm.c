/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include "ufsm.h"

static struct ufsm_transition * ufsm_get_first_state (
                        struct ufsm_region *region)
{
   
    for (struct ufsm_state *s = region->state; s; s = s->next) {
        if (s->kind == UFSM_STATE_INIT || 
            s->kind == UFSM_STATE_SHALLOW_HISTORY ||
            s->kind == UFSM_STATE_DEEP_HISTORY) 
        {

            for (struct ufsm_transition *t = region->transition;t;t = t->next) {
                if (t->source == s)
                    return t;
                
            }
        }
    }

    return NULL;
}

static uint32_t ufsm_make_transition(struct ufsm_machine *m,
                                     struct ufsm_transition *t,
                                     struct ufsm_region *r);

static uint32_t ufsm_enter_parent_regions(struct ufsm_machine *m,
                                          struct ufsm_region *ancestor,
                                          struct ufsm_region *r)
{
    uint32_t err = UFSM_OK;

    if (ancestor == r)
        return UFSM_OK;

    if (m->debug_enter_region)
        m->debug_enter_region(r);

    if (r->parent_state)
        if (r->parent_state->parent_region)
        {
            r->parent_state->parent_region->current = r->parent_state;
            ufsm_enter_parent_regions(m,ancestor,
                        r->parent_state->parent_region);
        }

    for (struct ufsm_entry_exit *e = r->parent_state->entry; e; e = e->next)
        e->f();

    if (r->has_history)
        ancestor->history = ancestor->current;

    struct ufsm_transition *t = ufsm_get_first_state(r);

    if (t) {
        err = ufsm_make_transition(m, t, r);
        if (err != UFSM_OK)
            return err;
    }
    
    return UFSM_OK;
}

static uint32_t ufsm_leave_parent_regions(struct ufsm_machine *m,
                                          struct ufsm_region *ancestor,
                                          struct ufsm_region *r)
{
    struct ufsm_entry_exit *e = NULL;
    
    if (ancestor == r)
        return UFSM_OK;

    if (m->debug_leave_region)
        m->debug_leave_region(r);

    r->current = NULL;

    if (r->parent_state)
        e = r->parent_state->exit;

    for (;e; e = e->next)
        e->f();
  
    if (r->parent_state)
        if (r->parent_state->parent_region)
            ufsm_leave_parent_regions(m, ancestor,
                        r->parent_state->parent_region);

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
   if (regions->current)
        if (regions->current->region)
            ufsm_leave_nested_states(m, regions->current->region);
 
    if (regions->current) {
        for (struct ufsm_entry_exit *e = regions->current->exit; e; e = e->next)
            e->f();
        if (!regions->has_history)
            regions->current = NULL;
    }
            
    return UFSM_OK;
}

static uint32_t ufsm_init_region(struct ufsm_machine *m,
                                struct ufsm_region *regions);

static uint32_t ufsm_make_transition(struct ufsm_machine *m,
                                     struct ufsm_transition *t,
                                     struct ufsm_region *r)
{
    uint32_t err = UFSM_OK;
    struct ufsm_state *dest = t->dest;
    struct ufsm_state *src = t->source;
    struct ufsm_region *act_region = r;
    struct ufsm_region *lca_region = NULL;

    if (m->debug_transition)
        m->debug_transition(t);
    
    /* When H state entered implicitly through region initialisation */
    if (src->kind == UFSM_STATE_SHALLOW_HISTORY ||
        src->kind == UFSM_STATE_DEEP_HISTORY) 
    {
        if (src->parent_region->history)
            dest = src->parent_region->history;
    }

    /* Check all guards */
    for (struct ufsm_guard *g = t->guard; g; g = g->next) {
        bool guard_ok = g->f();
        if (m->debug_guard)
            m->debug_guard(g, guard_ok);
        if (!guard_ok)
            return UFSM_OK;
    }
    /* If we are in a composite state make sure to exit all nested states */
    if (src->region)
        if (src->region->current) {
            err = ufsm_leave_nested_states(m, src->region);
            if (err != UFSM_OK)
                return err;
        }

    /* Call exit functions in previous state */
    if (t->kind == UFSM_TRANSITION_EXTERNAL) 
        for (struct ufsm_entry_exit *f = src->exit; f; f = f->next)
            f->f();

    /* For compound transitions parents must be exited and entered
     * in the correct order.
     * */
    if (src->parent_region != dest->parent_region) {
        act_region = dest->parent_region;
        lca_region = ufsm_least_common_ancestor(src->parent_region,
                                                dest->parent_region);
        if (!lca_region) 
            return UFSM_ERROR_LCA_NOT_FOUND;

        err = ufsm_leave_parent_regions(m, lca_region, src->parent_region);

        if (err != UFSM_OK)
            return err;
    }
   
    for (struct ufsm_action *a = t->action; a; a = a->next) {
        if (m->debug_action)
            m->debug_action(a);
        a->f();
    }

    if (lca_region) {
        err = ufsm_enter_parent_regions(m, lca_region, dest->parent_region);

        if (err != UFSM_OK)
            return err;
    }
    /* Decode pseudostates */
    switch(dest->kind) {
        case UFSM_STATE_SIMPLE:
            /* Do nothing */
        break;
        case UFSM_STATE_SHALLOW_HISTORY:
            if (act_region->history)
                dest = act_region->history;
        break;
        case UFSM_STATE_DEEP_HISTORY:
            if (act_region->history)
                dest = act_region->history;
        break;
        case UFSM_STATE_ENTRY_POINT:
        case UFSM_STATE_EXIT_POINT:
            for (struct ufsm_transition *te = dest->parent_region->transition;
                                                          te; te = te->next) 
            {
                if (te->source == dest)
                    return ufsm_make_transition(m, te, te->dest->parent_region);
            }
        break;
        case UFSM_STATE_FINAL:
            act_region->current = dest;
            bool really_final = true;

            if (r->parent_state) {
                for (struct ufsm_region *rf = r->parent_state->region; 
                        rf; rf = rf->next) 
                {
                    if (rf->current->kind != UFSM_STATE_FINAL)
                        really_final = false;
                }
            }

            if (really_final && r->parent_state) {
                for (struct ufsm_transition *tf = 
                            r->parent_state->parent_region->transition; 
                            tf; tf = tf->next) 
                {
                    if (tf->dest->kind == UFSM_STATE_FINAL &&
                        tf->source == r->parent_state) {
                        dest = tf->dest;
                        err = ufsm_make_transition(m, tf,
                                    r->parent_state->parent_region);
                        if (err != UFSM_OK)
                            return err;
                    }
                }
            }
        break;
        default:
            return UFSM_ERROR_UNKNOWN_STATE_KIND;
        break;
    }
    /* Update current state */

    if (dest->parent_region) 
        if (dest->parent_region->has_history)
            dest->parent_region->history = dest;

    act_region->current = dest;

    if (dest->submachine) {
        err = ufsm_init_machine(dest->submachine);
        if (err != UFSM_OK)
            return err;
    }

    /* Call entry functions in new state */
    if (t->kind == UFSM_TRANSITION_EXTERNAL) 
        for (struct ufsm_entry_exit *f = dest->entry; f; f = f->next)
            f->f();

    for (struct ufsm_region *s_r = dest->region; s_r; s_r = s_r->next) {
        err = ufsm_init_region(m, s_r);
        if (err != UFSM_OK)
            return err;
    }

    return UFSM_OK;
}

static uint32_t ufsm_init_region(struct ufsm_machine *m,
                                struct ufsm_region *regions) 
{
    uint32_t err = UFSM_OK;
    struct ufsm_transition *t = ufsm_get_first_state(regions);

    if (t) {
        err = ufsm_make_transition(m, t,regions);
    } else {
        if (regions->has_history && regions->history) {
            regions->current = regions->history;
            if (m->debug_enter_region)
                m->debug_enter_region(regions);
            for (struct ufsm_entry_exit *f = regions->current->entry; f; f = f->next)
                f->f();
        }
    }

    return err;
}

uint32_t ufsm_init_machine(struct ufsm_machine *m) 
{
    uint32_t err = UFSM_OK;

    for (struct ufsm_region *r = m->region; r; r = r->next) {
        err = ufsm_init_region(m, r);

        if (err != UFSM_OK)
            return err;
    }

    return UFSM_OK;
}

static uint32_t ufsm_process_region (struct ufsm_machine *m,
                                     struct ufsm_region *regions, 
                                     uint32_t ev) 
{
    struct ufsm_state *s = regions->current;
    bool events_processed = false;
    uint32_t err = UFSM_OK;

    if (regions->current->submachine) {
        err = ufsm_process_region(m, regions->current->submachine->region, ev);
        if (err != UFSM_OK && err != UFSM_ERROR_EVENT_NOT_PROCESSED)
            return err;
        else
            events_processed = true;
    }

    for (struct ufsm_region *r = s->region; r; r = r->next) {
        err = ufsm_process_region(m, r, ev);
        if (err != UFSM_OK && err != UFSM_ERROR_EVENT_NOT_PROCESSED)
            return err;
        else
            events_processed = true;
    }
 
    for (struct ufsm_transition *t = regions->transition; t; t = t->next) {
        if (t->trigger == ev && t->source == s) {
            events_processed = true;
            err = ufsm_make_transition(m, t, regions);
            if (err != UFSM_OK)
                return err;
        }
    }

    return events_processed ? UFSM_OK : UFSM_ERROR_EVENT_NOT_PROCESSED;
}

uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev) 
{
    uint32_t err = UFSM_OK;
    bool event_processed = false;

    if (m->debug_event)
        m->debug_event(ev);

    for (struct ufsm_region *r = m->region; r; r = r->next) {
        err = ufsm_process_region(m, m->region, ev);

        if (err != UFSM_OK && err != UFSM_ERROR_EVENT_NOT_PROCESSED)
            return err;
        if (err == UFSM_OK)
            event_processed = true;
    }

    return event_processed ? UFSM_OK : UFSM_ERROR_EVENT_NOT_PROCESSED;
}
