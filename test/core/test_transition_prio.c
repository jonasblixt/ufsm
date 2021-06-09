#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_transition_prio.gen.h"

static bool flag_eA,flag_xA,flag_eB,flag_xB,flag_eC,flag_xC,flag_eD,flag_xD,
            flag_eE, flag_eF, flag_xF, flag_eG, flag_xG, flag_eH, flag_xH;

static void reset_flags(void)
{
    flag_eA = false;
    flag_xA = false;
    flag_eB = false;
    flag_xB = false;
    flag_eC = false;
    flag_xC = false;
    flag_eD = false;
    flag_xD = false;
    flag_eE = false;
    flag_eF = false;
    flag_xF = false;
    flag_eG = false;
    flag_xG = false;
    flag_eH = false;
    flag_xH = false;
}

void eA(void *ctx)
{
    flag_eA = true;
}

void xA(void *ctx)
{
    flag_xA = true;

    assert ("xC" && flag_xD && flag_xC && flag_xH && flag_xB
                 && flag_xA && flag_xF);
}

void eB(void *ctx)
{
    flag_eB = true;
}

void xB(void *ctx)
{
    flag_xB = true;

    assert ("xB" && flag_xD && flag_xC && flag_xH && flag_xB && flag_xC
                 && !flag_xA && flag_xF);

}

void eC(void *ctx)
{
    flag_eC = true;
}

void xC(void *ctx)
{
    flag_xC = true;

    assert ("xC" && flag_xD && flag_xC && flag_xH && !flag_xB
                 && !flag_xA && flag_xF);

}

void eD(void *ctx)
{
    flag_eD = true;
}

void xD(void *ctx)
{
    flag_xD = true;

    assert ("xD" && flag_xD && !flag_xC && flag_xH && !flag_xB && !flag_xC
                 && !flag_xA && flag_xF);

}

void eE(void *ctx)
{
    flag_eE = true;
}

void eF(void *ctx)
{
    flag_eF = true;
    assert ("eF" && flag_eH);
}

void xF(void *ctx)
{
    flag_xF = true;

    assert ("xF" && !flag_xD && !flag_xC && flag_xH && !flag_xB && !flag_xC
                 && !flag_xA);

}

void eG(void *ctx)
{
    flag_eG = true;
}

void xG(void *ctx)
{
    flag_xG = true;
}

void eH(void *ctx)
{
    flag_eH = true;

    assert ("eH" && !flag_eF);
}

void xH(void *ctx)
{
    flag_xH = true;

    assert ("xH" && !flag_xD && !flag_xC && flag_xH && !flag_xB && !flag_xC
                 && !flag_xA && !flag_xF);

}

int main(void)
{
    int rc;
    struct transition_prio_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();

    transition_prio_machine_initialize(&machine, NULL);

    assert ("step1" && flag_eA && flag_eC && flag_eD && flag_eE && flag_eB
                    && flag_eG && !flag_xA && !flag_xD && !flag_eF && !flag_xB
                    && !flag_xG && !flag_eH && !flag_xH);

    rc = ufsm_process(m, EV);
    assert(rc == 0);
    reset_flags();

    rc = ufsm_process(m, EV2);
    assert(rc == 0);

    return 0;
}
