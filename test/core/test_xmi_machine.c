#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include <assert.h>
#include "test_xmi_machine.gen.h"

static bool flag_eC = false;
static bool flag_eD = false;
static bool flag_t1 = false;
static bool flag_t2 = false;
static bool flag_t3 = false;
static bool flag_final = false;

static void reset_flags(void)
{
    flag_eC = false;
    flag_eD = false;
    flag_t1 = false;
    flag_t2 = false;
    flag_t3 = false;
    flag_final = false;
}


bool Guard(void *ctx)
{
    return true;
}

void DoAction(void *ctx)
{
}

void eD(void *ctx)
{
    flag_eD = true;
}

void eC(void *ctx)
{
    flag_eC = true;
}

void t1(void *ctx)
{
    flag_t1 = true;
}

void t2(void *ctx)
{
    flag_t2 = true;
}

void t3(void *ctx)
{
    flag_t3 = true;
}

void final(void *ctx)
{
    flag_final = true;
}

int main(void)
{
    struct test_xmi_machine_machine machine;
    ufsm_debug_machine(&machine.machine);

    struct ufsm_machine *m = &machine.machine;
    uint32_t err = UFSM_OK;

    assert (test_xmi_machine_machine_initialize(&machine, NULL) == UFSM_OK);
    assert (flag_eC);

    ufsm_process (m, EV_D);
    ufsm_process (m, EV_B);

    reset_flags();

    ufsm_process (m, EV_E);
    ufsm_process (m, EV_B);
    ufsm_process (m, EV_A);
    assert("Should be in state 'D'" && flag_eD);

    reset_flags();
    ufsm_process (m, EV_B);
    ufsm_process (m, EV_E);
    assert (!flag_t1 && !flag_t2 && !flag_t3);
    err = ufsm_process (m, EV_E1);
    if (err != UFSM_OK) {
        printf ("Error: %i\n", err);
        assert(0);
    }

    assert (flag_t1);
    assert (!flag_t2);
    assert (!flag_t3);
    assert (flag_t1 && !flag_t2 && !flag_t3);
    assert (ufsm_process (m, EV_E2) == UFSM_OK);
    assert (flag_t1 && flag_t2 && !flag_t3);
    assert (ufsm_process (m, EV_E3) == UFSM_OK);
    assert (flag_t1 && flag_t2 && flag_t3);
    assert (flag_final);
    return 0;
}
