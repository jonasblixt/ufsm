#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_deephistory.gen.h"

static bool flag_final = false;
static bool flag_eB = false;
static bool flag_eA2 = false;
static bool flag_xA2 = false;
static bool flag_eA1 = false;
static bool flag_xA1 = false;
static bool flag_eE = false;
static bool flag_xE = false;
static bool flag_eD = false;
static bool flag_xD = false;
static bool flag_eC = false;
static bool flag_xC = false;
static bool flag_eA = false;
static bool flag_xA = false;

static void reset_flags(void)
{
    flag_final = false;
    flag_eB = false;
    flag_eA2 = false;
    flag_xA2 = false;
    flag_eA1 = false;
    flag_xA1 = false;
    flag_eE = false;
    flag_xE = false;
    flag_eD = false;
    flag_xD = false;
    flag_eC = false;
    flag_xC = false;
    flag_eA = false;
    flag_xA = false;
}

void final(void *ctx)
{
    flag_final = true;
}

void eB(void *ctx)
{
    flag_eB = true;
}

void eA2(void *ctx)
{
    flag_eA2 = true;
}

void xA2(void *ctx)
{
    flag_xA2 = true;
}

void eA1(void *ctx)
{
    flag_eA1 = true;
}

void xA1(void *ctx)
{
    flag_xA1 = true;
}

void eE(void *ctx)
{
    flag_eE = true;
}

void xE(void *ctx)
{
    flag_xE = true;
}

void eD(void *ctx)
{
    flag_eD = true;
}

void xD(void *ctx)
{
    flag_xD = true;
}

void eC(void *ctx)
{
    flag_eC = true;
}

void xC(void *ctx)
{
    flag_xC = true;
}

void eA(void *ctx)
{
    flag_eA = true;
}

void xA(void *ctx)
{
    flag_xA = true;
}

int main(void)
{
    struct test_deep_history_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);
    test_deep_history_machine_initialize(&machine, NULL);
    assert(!flag_final &&
        flag_eB &&
        !flag_eA2 &&
        !flag_xA2 &&
        !flag_eA1 &&
        !flag_xA1 &&
        !flag_eE &&
        !flag_xE &&
        !flag_eD &&
        !flag_xD &&
        !flag_eC &&
        !flag_xC &&
        !flag_eA &&
        !flag_xA);

    reset_flags();
    ufsm_process(m, EV_A);
    assert(!flag_final &&
        !flag_eB &&
        !flag_eA2 &&
        !flag_xA2 &&
        flag_eA1 &&
        !flag_xA1 &&
        !flag_eE &&
        !flag_xE &&
        !flag_eD &&
        !flag_xD &&
        !flag_eC &&
        !flag_xC &&
        flag_eA &&
        !flag_xA);


    ufsm_process(m, EV_1);
    ufsm_process(m, EV_1);
    ufsm_process(m, EV_1);

    assert(!flag_final &&
        !flag_eB &&
        flag_eA2 &&
        flag_xA2 &&
        flag_eA1 &&
        flag_xA1 &&
        flag_eE &&
        flag_xE &&
        flag_eD &&
        !flag_xD &&
        flag_eC &&
        !flag_xC &&
        flag_eA &&
        !flag_xA);

    reset_flags();
    ufsm_process(m, EV_B);


    assert(!flag_final &&
        flag_eB &&
        !flag_eA2 &&
        !flag_xA2 &&
        !flag_eA1 &&
        !flag_xA1 &&
        !flag_eE &&
        !flag_xE &&
        !flag_eD &&
        flag_xD &&
        !flag_eC &&
        flag_xC &&
        !flag_eA &&
        flag_xA);

    reset_flags();
    ufsm_process(m, EV_A);


    assert(!flag_final &&
        !flag_eB &&
        !flag_eA2 &&
        !flag_xA2 &&
        !flag_eA1 &&
        !flag_xA1 &&
        !flag_eE &&
        !flag_xE &&
        flag_eD &&
        !flag_xD &&
        flag_eC &&
        !flag_xC &&
        flag_eA &&
        !flag_xA);

    reset_flags();
    ufsm_process(m, EV_1);

    assert(!flag_final &&
        !flag_eB &&
        !flag_eA2 &&
        !flag_xA2 &&
        flag_eA1 &&
        !flag_xA1 &&
        !flag_eE &&
        !flag_xE &&
        !flag_eD &&
        flag_xD &&
        !flag_eC &&
        flag_xC &&
        !flag_eA &&
        !flag_xA);

    ufsm_process(m ,EV_1);
    reset_flags();
    ufsm_process(m, EV_EXIT);

    assert(flag_final &&
        !flag_eB &&
        !flag_eA2 &&
        flag_xA2 &&
        !flag_eA1 &&
        !flag_xA1 &&
        !flag_eE &&
        !flag_xE &&
        !flag_eD &&
        !flag_xD &&
        !flag_eC &&
        !flag_xC &&
        !flag_eA &&
        flag_xA);


    return 0;
}
