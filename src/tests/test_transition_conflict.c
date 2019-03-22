#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_transition_conflict_input.h>
#include "common.h"

static bool flag_eA, flag_xA, flag_xB, flag_eC;

static void reset_flags(void)
{
    flag_eA = false;
    flag_xA = false;
    flag_xB = false;
    flag_eC = false;
}

void eA(void)
{
    flag_eA = true;
}

void xA(void)
{
    flag_xA = true;
}

void xB(void)
{
    flag_xB = true;
}

void eC(void)
{
    flag_eC = true;
}

int main(void)
{
    struct ufsm_machine *m = get_StateMachine1();
    reset_flags();
    test_init(m);
    ufsm_init_machine(m);

    assert("Init" && flag_eA && !flag_xA && !flag_xB && !flag_eC);

    test_process(m, EV1);

    assert("Step1" && flag_eA && flag_xA && !flag_xB && !flag_eC);
    reset_flags();

    test_process(m, EV2);

    assert("Step2" && flag_eA && !flag_xA && flag_xB && !flag_eC);

    test_process(m, EV2);

    assert("Step3" && flag_eA && flag_xA && flag_xB && flag_eC);

    return 0;
}
