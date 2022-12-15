#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_nested_states3.gen.h"

static bool flag_eB, flag_eB1, flag_eB2,
            flag_xB, flag_xB1, flag_xB2;

void eB(void *ctx)
{
    flag_eB = true;
}

void xB(void *ctx)
{
    flag_xB = true;
}

void eB1(void *ctx)
{
    flag_eB1 = true;
}

void xB1(void *ctx)
{
    flag_xB1 = true;
}

void eB2(void *ctx)
{
    flag_eB2 = true;
}

void xB2(void *ctx)
{
    flag_xB2 = true;
}

void eB11(void *ctx)
{
}

void eB20(void *ctx)
{
}

void xB11(void *ctx)
{
}

int main(void) 
{
    int rc;
    struct test_nested_states3_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    test_nested_states3_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eStart);
    assert(rc == 0);
    assert(flag_eB && flag_eB1 && flag_eB2);

    rc = ufsm_process(m, eStop);
    assert(rc == 0);
    assert(flag_xB && flag_xB1 && flag_xB2);

    return 0;
}

