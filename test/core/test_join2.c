#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_join2.gen.h"

static bool flag_eB;

static void reset_flags(void)
{
    flag_eB = false;
}

void eB(void *ctx)
{
    flag_eB = true;
}

int main(void) 
{
    int rc;
    struct join2_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();

    join2_machine_initialize(&machine, NULL);

    assert (!flag_eB);

    rc = ufsm_process(m, EV);
    assert(rc == 0);
    assert(flag_eB);

    return 0;
}
