#include <stdio.h>
#include "common.h"

void debug_transition (struct ufsm_transition *t)
{
    printf ("    | Transition | %s {%s} --> %s {%s}\n", t->source->name,
                                            ufsm_state_kinds[t->source->kind],
                                            t->dest->name,
                                            ufsm_state_kinds[t->dest->kind]);
}

void debug_enter_region(struct ufsm_region *r)
{
    printf ("    | R enter    | %s, H=%i\n", r->name, r->has_history);
}

void debug_leave_region(struct ufsm_region *r)
{
    printf ("    | R exit     | %s, H=%i\n", r->name, r->has_history);
}

void debug_event(uint32_t ev)
{
    printf (" %-3i|            |\n",ev);
}

void debug_action(struct ufsm_action *a)
{
    printf ("    | Action     | %s()\n",a->name);
}

void debug_guard(struct ufsm_guard *g, bool result) 
{
    printf ("    | Guard      | %s() = %i\n", g->name, result);
}

void debug_enter_state(struct ufsm_state *s)
{
    printf ("    | S enter    | %s {%s}\n", s->name,ufsm_state_kinds[s->kind]);
}

void debug_exit_state(struct ufsm_state *s)
{
    printf ("    | S exit     | %s {%s}\n", s->name,ufsm_state_kinds[s->kind]);
}


void test_process(struct ufsm_machine *m, uint32_t ev)
{
    assert (ufsm_process(m,ev) == UFSM_OK);
}



void test_init(struct ufsm_machine *m)
{

    m->debug_transition = &debug_transition;
    m->debug_enter_region = &debug_enter_region;
    m->debug_leave_region = &debug_leave_region;
    m->debug_event = &debug_event;
    m->debug_action = &debug_action;
    m->debug_guard = &debug_guard;
    m->debug_enter_state = &debug_enter_state;
    m->debug_exit_state = &debug_exit_state;

    printf (" EV |     OP     | Details\n");

}


