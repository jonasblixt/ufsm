
#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_join2_input.h>
#include "common.h"

static bool flag_eB;

static void reset_flags(void)
{
    flag_eB = false;
}

void eB(void)
{
    flag_eB = true;
}

int main(void) 
{
    struct ufsm_machine *m = get_StateMachine1();
    reset_flags();
    test_init(m);
    ufsm_init_machine(m);
   
    assert (!flag_eB);

    test_process(m, EV);

    assert(flag_eB);

    return 0;
}
