#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_guards2.gen.h"

int gval = 0;
bool feA, feB, feC, feD, feE, feF, feG, feH, feEnd;

void reset(void)
{
    feA = false;
    feB = false;
    feC = false;
    feD = false;
    feE = false;
    feF = false;
    feG = false;
    feH = false;
    feEnd = false;
}

int gGuard(void *ctx)
{
    return gval;
}

void eEnd(void *ctx)
{
    feEnd = true;
}

void eA(void *ctx)
{
    feA = true;
}

void eB(void *ctx)
{
    feB = true;
}

void eC(void *ctx)
{
    feC = true;
}

void eD(void *ctx)
{
    feD = true;
}

void eE(void *ctx)
{
    feE = true;
}

void eF(void *ctx)
{
    feF = true;
}

void eG(void *ctx)
{
    feG = true;
}

void eH(void *ctx)
{
    feH = true;
}


int main(void) 
{
    int rc;
    struct test_guards2_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);
    test_guards2_machine_initialize(&machine, NULL);

    reset();
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feA == false);

    gval = 1;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feA == true);

    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feB == false);

    gval = 0;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feB == true);

    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feC == false);

    gval = 3;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feC == true);

    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feD == false);

    gval = 5;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feD == true);

    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feE == false);

    gval = 10;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feE == true);

    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feF == false);

    gval = -1;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feF == false);

    gval = -2;
    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feF == true);

    rc = ufsm_process(m, eEvent);
    assert(rc == 0);
    assert(feG == true);
    assert(feEnd == true);
    return 0;
}
