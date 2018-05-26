#include <stdio.h>
#include "ufsm.h"

static struct ufsm_transition * _ufsm_get_first_state (
                        struct ufsm_region *region)
{
   
    for (struct ufsm_state *s = region->state; s; s = s->next) {
        if (s->kind == UFSM_STATE_INIT || 
            s->kind == UFSM_STATE_SHALLOW_HISTORY ||
            s->kind == UFSM_STATE_DEEP_HISTORY) {

            for (struct ufsm_transition *t = region->transition;t;t = t->next) {
                if (t->source == s)
                    return t;
                
            }
        }
    }

    return NULL;
}

static uint32_t _ufsm_init(struct ufsm_region *regions);

static uint32_t _ufsm_make_transition(struct ufsm_transition *t,
                                      struct ufsm_region *r)
{
    struct ufsm_state *dest = t->dest;
    struct ufsm_state *src = t->source;

    if (src->kind == UFSM_STATE_SHALLOW_HISTORY) {
        if (r->history)
            dest = r->history;
    }

    printf ("Transition [%s] from %s -> %s ",r->name, src->name,dest->name);
    /* Check all guards */
    for (struct ufsm_guard *g = t->guard; g; g = g->next)
        if (!g->f())
            return UFSM_ERROR;

    /* Call exit functions in previous state */
    if (t->kind == UFSM_TRANSITION_EXTERNAL) 
        for (struct ufsm_entry_exit *f = src->exit; f; f = f->next) 
            f->f();
    
    for (struct ufsm_action *a = t->action; a; a = a->next)
        a->f();
    
    printf ("OK\n");
    /* New state in region 'r' */

    if (dest->kind == UFSM_STATE_SHALLOW_HISTORY) {
        printf ("Entering into a shallow history state\n");
        if (r->history)
            dest = r->history;
        printf("  new state: %s\n",dest->name);
    }
    
    r->current = dest;

    if (dest->submachine)
        ufsm_init(dest->submachine);

    /* Call entry functions in new state */
    if (t->kind == UFSM_TRANSITION_EXTERNAL) 
        for (struct ufsm_entry_exit *f = dest->entry; f; f = f->next)
            f->f();

    for (struct ufsm_region *s_r = dest->region; s_r; s_r = s_r->next)
        _ufsm_init(s_r);

    /* Update history */
    if (r->has_history)
        r->history = r->current;

    return UFSM_OK;
}

static uint32_t _ufsm_init(struct ufsm_region *regions) 
{
    struct ufsm_transition *t = NULL;

    t = _ufsm_get_first_state(regions);
    if (t == NULL) {
        printf ("Could not find initializing transition for region\n");
        return UFSM_ERROR;
    } else {
        return _ufsm_make_transition(t,regions);
    }
}

uint32_t ufsm_init(struct ufsm_machine *m) 
{
    struct ufsm_region *r = m->region;
    printf ("Initializing machine '%s'\n",m->name);

    while (r) {
        if (_ufsm_init(r) != UFSM_OK)
            return UFSM_ERROR;
        r = r->next;
    }
    return UFSM_OK;
}

static uint32_t _ufsm_process (struct ufsm_region *regions, uint32_t ev) 
{
    struct ufsm_state *s = regions->current;
    bool events_processed = false;

    if (regions->current->submachine)
        _ufsm_process(regions->current->submachine->region, ev);

    if (s->region) {
        if(_ufsm_process(s->region, ev) == UFSM_OK)
            events_processed = true;
    }
 
    for (struct ufsm_transition *t = regions->transition; t; t = t->next) {
        if (t->trigger == ev && t->source == regions->current) {
            events_processed = true;
            _ufsm_make_transition(t, regions);
        }
    }

    if (events_processed)
        return UFSM_OK;
    else
        return UFSM_ERROR;
}

uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev) 
{
    struct ufsm_region *r = m->region;
    printf ("Processing event %i, state = '%s'\n",ev,r->current->name);
    return _ufsm_process(r, ev);
}

