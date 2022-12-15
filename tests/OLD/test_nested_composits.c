#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_nested_composits.gen.h"

bool flag_xA11, flag_eA11, flag_xA12, flag_eA12, flag_xA12Dummy, 
     flag_eA12Dummy, flag_xA13, flag_eA13, flag_xInitA, flag_eInitA,
     flag_eAEnd, flag_xA21, flag_eA21, flag_xA22, flag_eA22;

static void reset_flags(void)
{
    flag_xA11 = false;
    flag_eA11 = false;
    flag_xA12 = false;
    flag_eA12 = false;
    flag_xA12Dummy = false;
    flag_eA12Dummy = false;
    flag_xA13 = false;
    flag_eA13 = false;
    flag_xInitA = false;
    flag_eInitA = false;
    flag_eAEnd = false;
    flag_xA21 = false;
    flag_eA21 = false;
    flag_xA22 = false;
    flag_eA22 = false;
}

void xA11(void *ctx)
{
    flag_xA11 = true;
}

void eA11(void *ctx)
{
    flag_eA11 = true;
}

void xA12(void *ctx)
{
    flag_xA12 = true;
}

void eA12(void *ctx)
{
    flag_eA12 = true;
}

void xA12dummy(void *ctx)
{
    flag_xA12Dummy = true;
}

void eA12dummy(void *ctx)
{
    flag_eA12Dummy = true;
}

void xA13(void *ctx)
{
    flag_xA13 = true;
}

void eA13(void *ctx)
{
    flag_eA13 = true;
}

void xInitA(void *ctx)
{
    flag_xInitA = true;
}

void eInitA(void *ctx)
{
    flag_eInitA = true;
}

void xA21(void *ctx)
{
    flag_xA21 = true;
}

void eA21(void *ctx)
{
    flag_eA21 = true;
}

void xA22(void *ctx)
{
    flag_xA22 = true;
}

void eA22(void *ctx)
{
    flag_eA22 = true;
}

void eAEnd(void *ctx)
{
    flag_eAEnd = true;
}

int main(void) 
{
    int rc;
    struct test_nested_composits_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();

    test_nested_composits_machine_initialize(&machine, NULL);

    assert ("Step1" && !flag_xA11 && !flag_eA11 && !flag_xA12 && !flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && !flag_xA13 && !flag_eA13 && 
     !flag_xInitA && flag_eInitA && !flag_eAEnd && !flag_xA21 && flag_eA21 &&
     !flag_xA22 && !flag_eA22);

    rc = ufsm_process(m, EV);
    assert(rc == 0);

    assert ("Step2" && flag_xA11 && flag_eA11 && !flag_xA12 && flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && flag_xA13 && flag_eA13 && 
     flag_xInitA && flag_eInitA && !flag_eAEnd && !flag_xA21 && flag_eA21 &&
     !flag_xA22 && !flag_eA22);

    rc = ufsm_process(m, EV3);
    assert(rc == 0);

    assert ("Step3" && flag_xA11 && flag_eA11 && !flag_xA12 && flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && flag_xA13 && flag_eA13 && 
     flag_xInitA && flag_eInitA && !flag_eAEnd && flag_xA21 && flag_eA21 &&
     !flag_xA22 && flag_eA22);

    rc = ufsm_process(m, EV2);
    assert(rc == 0);

    assert ("Step4" && flag_xA11 && flag_eA11 && flag_xA12 && flag_eA12 &&
     flag_xA12Dummy && flag_eA12Dummy && flag_xA13 && flag_eA13 && 
     flag_xInitA && flag_eInitA && flag_eAEnd && flag_xA21 && flag_eA21 &&
     !flag_xA22 && flag_eA22);
    return 0;
}
