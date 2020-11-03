#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_defer_input.h>
#include "common.h"

static bool flag_final = false;

void final(void)
{
    flag_final = true;
}

int main(void) 
{
    struct ufsm_machine *m = get_StateMachine1();
    int err = UFSM_OK;
    int ev;

    test_init(m);
    ufsm_init_machine(m);

    ufsm_process(m, EV_D);
    ufsm_process(m, EV_D);
    ufsm_process(m, EV_D);

    ufsm_process(m, EV);

    while(true) {
        err = ufsm_queue_get(&m->queue, &ev);
        if (err == UFSM_OK)
            test_process(m, ev);
        else
            break;
    }

    assert(flag_final);


   
    return 0;
}
