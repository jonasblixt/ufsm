#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_transition_prio_input.h>
#include "common.h"

static bool flag_eD = false;
static bool flag_eE = false;

static void reset_flags(void)
{
    flag_eD = false;
    flag_eE = false;
}

void eD(void)
{
    flag_eD = true;
}

void eE(void)
{
    flag_eE = true;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    test_init(m);
    ufsm_init_machine(m);

    test_process(m, EV1);
    test_process(m, EV1);
    assert (flag_eE &&
            !flag_eD);

    ufsm_reset_machine(m);
    reset_flags();
    ufsm_init_machine(m);
    test_process(m, EV2);

    assert (!flag_eE &&
            flag_eD);

    return 0;
}
