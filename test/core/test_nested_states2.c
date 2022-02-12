#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_nested_states2.gen.h"


bool flag_eA, flag_xA, flag_eB, flag_xB, flag_eC, flag_xC, flag_eD, flag_xD,
     flag_eE, flag_xE, flag_eF, flag_xF;

static void reset_flags(void)
{
   flag_eA = flag_xA = flag_eB = flag_xB = flag_eC = flag_xC = flag_eD = flag_xD =
     flag_eE = flag_xE = flag_eF = flag_xF = false;
}

void eA(void *ctx)
{
    flag_eA = true;
    assert("eA" &&
            flag_eA &&
            !flag_xA &&
            !flag_eB &&
            !flag_xB &&
            !flag_eC &&
            !flag_xC &&
            !flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void xA(void *ctx)
{
    flag_xA = true;

    assert("xA" &&
            flag_eA &&
            flag_xA &&
            flag_eB &&
            flag_xB &&
            flag_eC &&
            flag_xC &&
            !flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void eB(void *ctx)
{
    flag_eB = true;

    assert("eB" &&
            flag_eA &&
            !flag_xA &&
            flag_eB &&
            !flag_xB &&
            !flag_eC &&
            !flag_xC &&
            !flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void xB(void *ctx)
{
    flag_xB = true;

    assert("xB" &&
            flag_eA &&
            !flag_xA &&
            flag_eB &&
            flag_xB &&
            flag_eC &&
            flag_xC &&
            !flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void eC(void *ctx)
{
    flag_eC = true;

    assert("eC" &&
            flag_eA &&
            !flag_xA &&
            flag_eB &&
            !flag_xB &&
            flag_eC &&
            !flag_xC &&
            !flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void xC(void *ctx)
{
    flag_xC = true;

    assert("xC" &&
            flag_eA &&
            !flag_xA &&
            flag_eB &&
            !flag_xB &&
            flag_eC &&
            flag_xC &&
            !flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void eC2(void *ctx)
{
}

void xC2(void *ctx)
{
}

void eD(void *ctx)
{
    flag_eD = true;

    assert("eD" &&
            flag_eA &&
            flag_xA &&
            flag_eB &&
            flag_xB &&
            flag_eC &&
            flag_xC &&
            flag_eD &&
            !flag_xD &&
            !flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void xD(void *ctx)
{
    flag_xD = true;

}

void eE(void *ctx)
{
    flag_eE = true;

    assert("eE" &&
            flag_eA &&
            flag_xA &&
            flag_eB &&
            flag_xB &&
            flag_eC &&
            flag_xC &&
            flag_eD &&
            !flag_xD &&
            flag_eE &&
            !flag_xE &&
            !flag_eF &&
            !flag_xF);
}

void xE(void *ctx)
{
    flag_xE = true;
}

void eF(void *ctx)
{
    flag_eF = true;
    assert("eF" &&
            flag_eA &&
            flag_xA &&
            flag_eB &&
            flag_xB &&
            flag_eC &&
            flag_xC &&
            flag_eD &&
            !flag_xD &&
            flag_eE &&
            !flag_xE &&
            flag_eF &&
            !flag_xF);
}

void xF(void *ctx)
{
    flag_xF = true;
}

int main(void) 
{
    int rc;
    struct test_nested_states2_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();

    test_nested_states2_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eStart);
    assert(rc == 0);

    rc = ufsm_process(m, eStop);
    assert(rc == 0);
    return 0;
}
