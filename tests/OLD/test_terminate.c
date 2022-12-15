#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_terminate.gen.h"

static bool flag_xA = false;
static bool flag_eA = false;

void xA(void *ctx)
{
    flag_xA = true;
}

void eA(void *ctx)
{
    flag_eA = true;
}

int main(void) 
{
    int rc;
    struct test_terminate_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);
    test_terminate_machine_initialize(&machine, NULL);

    assert (flag_eA);

    rc = ufsm_process(m, EV);
    assert(rc == 0);
    assert(flag_eA && !flag_xA);
    assert (ufsm_process(m, EV) == -UFSM_ERROR_MACHINE_TERMINATED);
    assert (m->terminated);
    return 0;
}
