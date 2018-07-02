#include <assert.h>
#include <stdio.h>
#include <test_terminate_input.h>
#include <ufsm.h>
#include "common.h"

static bool flag_xA = false;
static bool flag_eA = false;

void xA(void) { flag_xA = true; }

void eA(void) { flag_eA = true; }

int main(void)
{
    struct ufsm_machine* m = get_StateMachine1();

    test_init(m);
    ufsm_init_machine(m);

    assert(flag_eA);

    test_process(m, EV);

    assert(flag_eA && !flag_xA);

    assert(ufsm_process(m, EV) == UFSM_ERROR_MACHINE_TERMINATED);

    assert(m->terminated);

    return 0;
}
