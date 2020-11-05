#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_transition_conflict_input.h>

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
    struct test_transition_conflict_machine machine;
    ufsm_debug_machine(&machine.machine);
    reset_flags();

    test_transition_conflict_machine_initialize(&machine, NULL);

    assert("Init" && flag_eA && !flag_xA && !flag_xB && !flag_eC);

    test_transition_conflict_machine_process(&machine, EV1);

    assert("Step1" && flag_eA && flag_xA && !flag_xB && !flag_eC);
    reset_flags();
    test_transition_conflict_machine_process(&machine, EV2);

    assert("Step2" && flag_eA && !flag_xA && flag_xB && !flag_eC);

    test_transition_conflict_machine_process(&machine, EV2);

    assert("Step3" && flag_eA && flag_xA && flag_xB && flag_eC);

    return 0;
}
