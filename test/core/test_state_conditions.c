#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_state_conditions.gen.h"

bool flag_eMode2 = false;

void eMode2(void *ctx)
{
    flag_eMode2 = true;
}

int main(void) 
{
    int rc;
    struct test_state_conditions_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);
    test_state_conditions_machine_initialize(&machine, NULL);


    rc = ufsm_process(m, eSwitchMode);
    assert(rc == 0);
    assert(flag_eMode2 == false);

    rc = ufsm_process(m, eToggle);
    assert(rc == 0);
    assert(flag_eMode2 == false);

    rc = ufsm_process(m, eSwitchMode);
    assert(rc == 0);
    assert(flag_eMode2 == true);
    return 0;
}
