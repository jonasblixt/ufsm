
#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_nested_composits2_input.h>
#include "common.h"

bool flag_xA11, flag_eA11, flag_xA12, flag_eA12, flag_xA12Dummy, 
     flag_eA12Dummy, flag_xA13, flag_eA13, flag_xInitA, flag_eInitA,
     flag_eAEnd, flag_xA21, flag_eA21, flag_xA22, flag_eA22, flag_eB;

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
    flag_eB = false;
}

void xA11(void)
{
    flag_xA11 = true;
}

void eA11(void)
{
    flag_eA11 = true;
}

void xA12(void)
{
    flag_xA12 = true;
}

void eA12(void)
{
    flag_eA12 = true;
}

void xA12Dummy(void)
{
    flag_xA12Dummy = true;
}

void eA12Dummy(void)
{
    flag_eA12Dummy = true;
}

void xA13(void)
{
    flag_xA13 = true;
}

void eA13(void)
{
    flag_eA13 = true;
}

void xInitA(void)
{
    flag_xInitA = true;
}

void eInitA(void)
{
    flag_eInitA = true;
}

void xA21(void)
{
    flag_xA21 = true;
}

void eA21(void)
{
    flag_eA21 = true;
}

void xA22(void)
{
    flag_xA22 = true;
}

void eA22(void)
{
    flag_eA22 = true;
}

void eAEnd(void)
{
    flag_eAEnd = true;
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
   
    assert ("Step1" && !flag_xA11 && !flag_eA11 && !flag_xA12 && !flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && !flag_xA13 && !flag_eA13 && 
     !flag_xInitA && flag_eInitA && !flag_eAEnd && !flag_xA21 && flag_eA21 &&
     !flag_xA22 && !flag_eA22 && !flag_eB);

    test_process(m, EV);

    assert ("Step2" && flag_xA11 && flag_eA11 && !flag_xA12 && flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && flag_xA13 && flag_eA13 && 
     flag_xInitA && flag_eInitA && !flag_eAEnd && !flag_xA21 && flag_eA21 &&
     !flag_xA22 && !flag_eA22 && !flag_eB);

    test_process(m, EV3);

    assert ("Step3" && flag_xA11 && flag_eA11 && !flag_xA12 && flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && flag_xA13 && flag_eA13 && 
     flag_xInitA && flag_eInitA && !flag_eAEnd && flag_xA21 && flag_eA21 &&
     !flag_xA22 && flag_eA22 && !flag_eB);

    test_process(m, EV_B);

    assert ("Step4" && flag_xA11 && flag_eA11 && flag_xA12 && flag_eA12 &&
     !flag_xA12Dummy && !flag_eA12Dummy && flag_xA13 && flag_eA13 && 
     flag_xInitA && flag_eInitA && !flag_eAEnd && flag_xA21 && flag_eA21 &&
     flag_xA22 && flag_eA22 && flag_eB);

    return 0;
}
