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

static uint32_t _ufsm_make_transition(struct ufsm_transition *t,
                                      struct ufsm_region *r);

static uint32_t ufsm_enter_parent_regions(struct ufsm_region *ancestor,
                                          struct ufsm_region *r)
{
    if (ancestor == r)
        return UFSM_OK;

    if (r->parent_state)
        if (r->parent_state->parent_region)
            ufsm_enter_parent_regions(ancestor,
                        r->parent_state->parent_region);



    printf ("Entering parent region %s\n", r->name);

    for (struct ufsm_entry_exit *e = r->parent_state->entry; e; e = e->next) {
        e->f();
    }

    struct ufsm_transition *t = _ufsm_get_first_state(r);


    if (t)
        _ufsm_make_transition(t, r);
    else
        printf ("Found no initialising state in '%s'\n",r->name);

    return UFSM_OK;
}

static uint32_t ufsm_leave_parent_regions(struct ufsm_region *ancestor,
                                          struct ufsm_region *r)
{
    struct ufsm_entry_exit *e = NULL;

    if (ancestor == r)
        return UFSM_OK;
 
    printf ("Leaving parent region %s\n",r->name);

    r->current = NULL;

    if (r->parent_state)
        e = r->parent_state->exit;

    for (;e; e = e->next)
        e->f();

  
    if (r->parent_state)
        if (r->parent_state->parent_region)
            ufsm_leave_parent_regions(ancestor,
                        r->parent_state->parent_region);

    return UFSM_OK;
}

static struct ufsm_region * ufsm_least_common_ancestor(struct ufsm_region *r1,
                                                      struct ufsm_region *r2)
{
    struct ufsm_region *lca = r1;
    struct ufsm_region *lca2 = r2;

    while (lca) {
        printf ("lca->name = %s\n",lca->name);
        lca2 = r2;
        do {
            printf ("  lca2->name = %s\n",lca2->name);
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

static uint32_t _ufsm_init(struct ufsm_region *regions);

static uint32_t _ufsm_make_transition(struct ufsm_transition *t,
                                      struct ufsm_region *r)
{
    struct ufsm_state *dest = t->dest;
    struct ufsm_state *src = t->source;
    struct ufsm_region *act_region = r;
    struct ufsm_region *lca_region = NULL;

    /* When H state entered implicitly through region initialisation */
    if (src->kind == UFSM_STATE_SHALLOW_HISTORY) {
        if (act_region->history)
            dest = r->history;
    }

    printf ("Transition  from %s {%s} -> %s {%s}\n", src->name,
                                                   src->parent_region->name,
                                                   dest->name,
                                                   dest->parent_region->name);

    /* Check all guards */
    for (struct ufsm_guard *g = t->guard; g; g = g->next)
        if (!g->f())
            return UFSM_ERROR;

    /* Call exit functions in previous state */
    if (t->kind == UFSM_TRANSITION_EXTERNAL) 
        for (struct ufsm_entry_exit *f = src->exit; f; f = f->next) {
            printf ("Calling exit function in %s\n",src->name);
            f->f();
        }

    if (src->parent_region != dest->parent_region) {
        printf ("   destination state is not in the same region\n");
        act_region = dest->parent_region;
        lca_region = ufsm_least_common_ancestor(src->parent_region,
                                                dest->parent_region);
        if (lca_region)
            printf (" Found LCA region: %s\n",lca_region->name);
        else
            printf (" Found no LCA :(\n");
        ufsm_leave_parent_regions(lca_region, src->parent_region);
    }

   
    for (struct ufsm_action *a = t->action; a; a = a->next)
        a->f();
    
    if (lca_region) 
        ufsm_enter_parent_regions(lca_region, dest->parent_region);


    /* Decode pseudostates */
    switch(dest->kind) {
        case UFSM_STATE_SIMPLE:
            /* Do nothing */
        break;
        case UFSM_STATE_SHALLOW_HISTORY:
            printf ("Entering into a shallow history state\n");
            if (act_region->history)
                dest = act_region->history;
            printf("  new state: %s\n",dest->name);
        break;
        case UFSM_STATE_EXIT_POINT:
            printf ("exit point region: %s\n", dest->parent_region->name);
            for (struct ufsm_transition *te = dest->parent_region->transition;te; te = te->next) {
                if (te->source == dest) {
                    printf ("New destination %s in region %s\n", te->dest->name,
                                                te->dest->parent_region->name);

                    return _ufsm_make_transition(te, te->dest->parent_region);
                }
            }
        break;
        case UFSM_STATE_ENTRY_POINT:
            printf ("entry point in region %s\n", dest->parent_region->name);
            for (struct ufsm_transition *te = dest->parent_region->transition; te; te = te->next) {
                if (te->source == dest) {
                    return _ufsm_make_transition(te, te->dest->parent_region);
                }
            }

        break;
        default:
            printf ("Error: unknown state kind = %i\n",dest->kind);
            return UFSM_ERROR;
        break;
    }

    /* Update current state */
    act_region->current = dest;
   
    if (dest->submachine)
        ufsm_init(dest->submachine);

    /* Call entry functions in new state */
    if (t->kind == UFSM_TRANSITION_EXTERNAL) 
        for (struct ufsm_entry_exit *f = dest->entry; f; f = f->next) {
            printf ("Calling entry function in '%s'\n",dest->name);
            f->f();
        }

    for (struct ufsm_region *s_r = dest->region; s_r; s_r = s_r->next)
        _ufsm_init(s_r);

    /* Update history */
    if (r->has_history)
        r->history = act_region->current;

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

