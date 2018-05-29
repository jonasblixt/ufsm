#include <stdio.h>
#include "common.h"

void debug_transition (struct ufsm_transition *t)
{
    printf ("T %-10s --> %-10s\n", t->source->name, t->dest->name);
}

void debug_enter_region(struct ufsm_region *r)
{
    printf ("R enter %s, H=%i\n", r->name, r->has_history);
}

void debug_leave_region(struct ufsm_region *r)
{
    printf ("R exit %s, H=%i\n", r->name, r->has_history);
}

void debug_event(uint32_t ev)
{
    printf ("E %i\n",ev);
}

void debug_action(struct ufsm_action *a)
{
    printf ("A %s\n",a->name);
}

void debug_guard(struct ufsm_guard *g, bool result) 
{
    printf ("G %s : %i\n", g->name, result);
}


void test_process(struct ufsm_machine *m, uint32_t ev)
{
    assert (ufsm_process(m,ev) == UFSM_OK);
}


