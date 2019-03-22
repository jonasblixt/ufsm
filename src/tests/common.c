#include <stdio.h>
#include "common.h"

static char *state_simple = "Simple State";
static char *state_composite = "Composite State";
static char *state_submachine = "Submachine State";

static char * get_state_type(struct ufsm_state *s)
{
    char * result = (char *) ufsm_state_kinds[s->kind];

    if (s->kind == UFSM_STATE_SIMPLE)
    {
        result = state_simple;

        if (s->region)
            result = state_composite;
        if (s->submachine)
            result = state_submachine;
    }

    return result;
}

void debug_transition (struct ufsm_transition *t)
{
#if UFSM_TESTS_VERBOSE == true


    char *source_type, *dest_type;


    source_type = (char *)ufsm_state_kinds[t->source->kind];
    dest_type = (char *)ufsm_state_kinds[t->dest->kind];

    if (t->source->kind == UFSM_STATE_SIMPLE)
    {
        source_type = state_simple;

        if (t->source->region)
            source_type = state_composite;

        if (t->source->submachine)
            source_type = state_submachine;
    }


    if (t->dest->kind == UFSM_STATE_SIMPLE)
    {
        dest_type = state_simple;

        if (t->dest->region)
            dest_type = state_composite;

        if (t->dest->submachine)
            dest_type = state_submachine;
    }

    printf ("    | Transition | %s {%s} --> %s {%s} T=", t->source->name,
                                            source_type,
                                            t->dest->name,
                                            dest_type);

    for (struct ufsm_trigger *tt = t->trigger;tt;tt=tt->next)
    {
        printf ("%s ", tt->name);
    }

    if (t->trigger == NULL)
        printf ("COMPLETION");

    printf("\n");
#endif
}

void debug_enter_region(struct ufsm_region *r)
{
#if UFSM_TESTS_VERBOSE == true
    printf ("    | R enter    | %s, H=%i\n", r->name, r->has_history);
#endif
}

void debug_leave_region(struct ufsm_region *r)
{
#if UFSM_TESTS_VERBOSE == true
    printf ("    | R exit     | %s, H=%i\n", r->name, r->has_history);
#endif
}

void debug_event(uint32_t ev)
{
#if UFSM_TESTS_VERBOSE == true
    printf (" %-3i|            |\n",ev);
#endif
}

void debug_action(struct ufsm_action *a)
{
#if UFSM_TESTS_VERBOSE == true
    printf ("    | Action     | %s()\n",a->name);
#endif
}

void debug_guard(struct ufsm_guard *g, bool result) 
{
#if UFSM_TESTS_VERBOSE == true
    printf ("    | Guard      | %s() = %i\n", g->name, result);
#endif
}

void debug_enter_state(struct ufsm_state *s)
{
#if UFSM_TESTS_VERBOSE == true
    printf ("    | S enter    | %s {%s}\n", s->name,get_state_type(s));
#endif
}

void debug_exit_state(struct ufsm_state *s)
{
#if UFSM_TESTS_VERBOSE == true
    printf ("    | S exit     | %s {%s}\n", s->name,get_state_type(s));
#endif
}


void debug_reset(struct ufsm_machine *m)
{
#if UFSM_TESTS_VERBOSE == true
    printf (" -- | RESET      | %s\n", m->name);
#endif
}

void test_process(struct ufsm_machine *m, uint32_t ev)
{
    uint32_t err = UFSM_OK;

    err = ufsm_process(m,ev);

    if (err != UFSM_OK)
        printf ("ERROR: %s\n", ufsm_errors[err]);
    assert (err == UFSM_OK);


    if (m->stack.pos == UFSM_STACK_SIZE)
        printf ("ERROR: Stack overflow!\n");
    else if (m->stack.pos > 0)
        printf ("ERROR: Stack did not return to zero\n");
    assert (m->stack.pos == 0);

    struct ufsm_queue *q = ufsm_get_queue(m);
    uint32_t q_ev;

    /* Process queued events */
    while (ufsm_queue_get(q, &q_ev) == UFSM_OK)
    {
        err = ufsm_process(m, q_ev);

        if (err != UFSM_OK)
            printf ("ERROR: %s\n", ufsm_errors[err]);
        assert (err == UFSM_OK);


        if (m->stack.pos == UFSM_STACK_SIZE)
            printf ("ERROR: Stack overflow!\n");
        else if (m->stack.pos > 0)
            printf ("ERROR: Stack did not return to zero\n");
        assert (m->stack.pos == 0);
    }
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
    m->debug_reset = &debug_reset;

#if UFSM_TESTS_VERBOSE == true
    printf (" EV |     OP     | Details\n");
#endif

}


