#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_ev_repeat_orth.gen.h"

static bool flag_eB3, flag_xB3, flag_eB2, flag_xB2,flag_eB1, flag_xB1,
            flag_eA1;

static void reset_flags(void)
{
    flag_eB3 = false;
    flag_xB3 = false;
    flag_eB2 = false;
    flag_xB2 = false;
    flag_eB1 = false;
    flag_xB1 = false;
    flag_eA1 = false;
}

void eB3(void *ctx)
{
    flag_eB3 = true;
}

void xB3(void *ctx)
{
    flag_xB3 = true;
}

void eB2(void *ctx)
{
    flag_eB2 = true;
}

void xB2(void *ctx)
{
    flag_xB2 = true;
}

void eB1(void *ctx)
{
    flag_eB1 = true;
}

void xB1(void *ctx)
{
    flag_xB1 = true;
}

void eA1(void *ctx)
{
    flag_eA1 = true;
}

int main(void)
{
    int rc;
    struct ev_repeat_orth_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();

    ev_repeat_orth_machine_initialize(&machine, NULL);
    assert (flag_eA1 && flag_eB1 && !flag_eB2 && !flag_eB3 &&
            !flag_xB1 && !flag_xB2 && !flag_xB3 &&
            "Enter A1 and B1");
    rc = ufsm_process(m, EV);
    assert(rc == 0);
    assert (flag_eA1 && flag_eB1 && flag_eB2 && !flag_eB3 &&
            flag_xB1 && !flag_xB2 && !flag_xB3 &&
            "Exit B1 enter B2");

    rc = ufsm_process(m, EV);
    assert(rc == 0);

    assert (flag_eA1 && flag_eB1 && flag_eB2 && flag_eB3 &&
            flag_xB1 && flag_xB2 && !flag_xB3 &&
            "Exit B2 enter B3");

    return 0;
}
