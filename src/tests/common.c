#include "common.h"
#include <stdio.h>

void debug_transition(struct ufsm_transition* t)
{
#if UFSM_TESTS_VERBOSE == true

    printf("    | Transition | %s {%s} --> %s {%s}\n",
           t->source->name,
           ufsm_state_kinds[t->source->kind],
           t->dest->name,
           ufsm_state_kinds[t->dest->kind]);
#endif
}

void debug_enter_region(struct ufsm_region* r)
{
#if UFSM_TESTS_VERBOSE == true
    printf("    | R enter    | %s, H=%i\n", r->name, r->has_history);
#endif
}

void debug_leave_region(struct ufsm_region* r)
{
#if UFSM_TESTS_VERBOSE == true
    printf("    | R exit     | %s, H=%i\n", r->name, r->has_history);
#endif
}

void debug_event(event_t ev)
{
#if UFSM_TESTS_VERBOSE == true
    printf(" %-3i|            |\n", ev);
#endif
}

void debug_action(struct ufsm_action* a)
{
#if UFSM_TESTS_VERBOSE == true
    printf("    | Action     | %s()\n", a->name);
#endif
}

void debug_guard(struct ufsm_guard* g, bool result)
{
#if UFSM_TESTS_VERBOSE == true
    printf("    | Guard      | %s() = %i\n", g->name, result);
#endif
}

void debug_enter_state(struct ufsm_state* s)
{
#if UFSM_TESTS_VERBOSE == true
    printf("    | S enter    | %s {%s}\n", s->name, ufsm_state_kinds[s->kind]);
#endif
}

void debug_exit_state(struct ufsm_state* s)
{
#if UFSM_TESTS_VERBOSE == true
    printf("    | S exit     | %s {%s}\n", s->name, ufsm_state_kinds[s->kind]);
#endif
}

void debug_reset(struct ufsm_machine* m)
{
#if UFSM_TESTS_VERBOSE == true
    printf(" -- | RESET      | %s\n", m->name);
#endif
}

void test_process(struct ufsm_machine* m, event_t ev)
{
    uint32_t err = UFSM_OK;

    err = ufsm_process(m, ev);

    if (err != UFSM_OK)
        printf("ERROR: %s\n", ufsm_errors[err]);
    assert(err == UFSM_OK);

    if (m->stack.pos == UFSM_STACK_SIZE)
        printf("ERROR: Stack overflow!\n");
    else if (m->stack.pos > 0)
        printf("ERROR: Stack did not return to zero\n");
    assert(m->stack.pos == 0);

    struct ufsm_queue* q = ufsm_get_queue(m);
    event_t q_ev;

    /* Process queued events */
    while (ufsm_queue_get(q, &q_ev) == UFSM_OK)
    {
        err = ufsm_process(m, q_ev);

        if (err != UFSM_OK)
            printf("ERROR: %s\n", ufsm_errors[err]);
        assert(err == UFSM_OK);

        if (m->stack.pos == UFSM_STACK_SIZE)
            printf("ERROR: Stack overflow!\n");
        else if (m->stack.pos > 0)
            printf("ERROR: Stack did not return to zero\n");
        assert(m->stack.pos == 0);
    }
}

void test_init(struct ufsm_machine* m)
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
    printf(" EV |     OP     | Details\n");
#endif
}
