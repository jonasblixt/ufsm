#include <stdio.h>
#include "common.h"

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

    ufsm_debug_machine(m);

}


