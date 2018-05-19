#include <stdio.h>
#include "ufsm.h"

static struct ufsm_transition * _ufsm_get_first_transition
                    (struct ufsm_transition *transitions)
{
    struct ufsm_transition *t = transitions;
    struct ufsm_state *source = NULL;

    while (t) {
        source = t->source;

        if (source->kind == UFSM_STATE_INIT)
            return t;

        if (source->kind == UFSM_STATE_SHALLOW_HISTORY)
            return t;
 
        if (source->kind == UFSM_STATE_DEEP_HISTORY)
            return t;
 

        t = t->next;
    }
    
    return NULL;
}

static uint32_t _ufsm_init(struct ufsm_region *regions);

static uint32_t _ufsm_make_transition(struct ufsm_transition *t,
                                struct ufsm_region *r)
{
    struct ufsm_guard *g = t->guard;
    struct ufsm_action *a = t->action;
    
    printf ("Transition from %s -> %s ",t->source->name,t->dest->name);
    /* Check all guards */
    while (g) {
        if (!g->f()) {
            printf ("FAILED\n");
            return UFSM_ERROR;
        }
        g = g->next;
    }

    /* Call exit functions in previous state */
    struct ufsm_entry_exit *f = t->source->exit;
    while (f) {
        f->f();
        f = f->next;
    }

    while (a) {
        a->f();
        a = a->next;
    }

    printf ("OK\n");

    r->current = t->dest;


    /* Call entry functions in new state */
    f = t->dest->entry;
    while (f) {
        f->f();
        f = f->next;
    }

    struct ufsm_region *regions = t->dest->region;

    while (regions) {
        _ufsm_init(regions);
        regions = regions->next;
    }

    return UFSM_OK;
}

static uint32_t _ufsm_init(struct ufsm_region *regions) 
{
    struct ufsm_state *s = regions->state;
    struct ufsm_region *r = NULL;
    struct ufsm_transition *t = NULL;

    printf ("Searching for init transition\n");

    while (s) {
        r = s->region;
        if (r != NULL) {
            _ufsm_init(r);
        }
        s = s->next;
    }

    t = _ufsm_get_first_transition(regions->transition);
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
    struct ufsm_state *s = regions->state;
    bool events_processed = false;

    while (s) {
        if (s->region) {
            if(_ufsm_process(s->region, ev) == UFSM_OK)
                events_processed = true;
        }
        s = s->next;
    }
    
    struct ufsm_transition *t = regions->transition;
 
    while (t) {
        if (t->trigger == ev && t->source == regions->current) {
            events_processed = true;
            _ufsm_make_transition(t, regions);
        }
        t = t->next;
    }

    if (events_processed)
        return UFSM_OK;
    else
        return UFSM_ERROR;
}

uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev) 
{
    struct ufsm_region *r = m->region;
    bool events_processed = false;

    printf ("Processing event %i, state = '%s'\n",ev,r->current->name);
    while (r) {
        if (_ufsm_process(r, ev) == UFSM_OK)
            events_processed = true;
        r = r->next;
    }

    if (events_processed)
        return UFSM_OK;
    else
        return UFSM_ERROR;
}


