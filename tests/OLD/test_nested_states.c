#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_nested_states.gen.h"

enum e_test_mode {
    TEST_MODE_1,
    TEST_MODE_2,
};

static enum e_test_mode test_mode = TEST_MODE_1;

bool flag_eA, flag_xA, flag_eB, flag_xB, flag_eC, flag_xC, flag_eD, flag_xD,
     flag_eE, flag_xE, flag_eF, flag_xF, flag_eG, flag_xG, flag_eH, flag_xH,
     flag_initB, flag_initC, flag_initD, flag_initF, flag_initG, flag_initH,
     flag_eEnd;

static void reset_flags(void)
{
   flag_eA = flag_xA = flag_eB = flag_xB = flag_eC = flag_xC = flag_eD = flag_xD =
     flag_eE = flag_xE = flag_eF = flag_xF = flag_eG = flag_xG = flag_eH = flag_xH =
     flag_initB = flag_initC = flag_initD = flag_initF = flag_initG = flag_initH =
     flag_eEnd = false;
}

void eA(void *ctx)
{
    flag_eA = true;
    if (test_mode == TEST_MODE_1) {
        assert("eA" &&
               flag_eA &&
               !flag_xA &&
               !flag_eB &&
               !flag_xB &&
               !flag_eC &&
               !flag_xC &&
               !flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eA" &&
               flag_eA &&
               !flag_xA &&
               !flag_eB &&
               !flag_xB &&
               !flag_eC &&
               !flag_xC &&
               !flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void xA(void *ctx)
{
    flag_xA = true;

    if (test_mode == TEST_MODE_1) {
        assert("xA" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("xA" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void eB(void *ctx)
{
    flag_eB = true;

    if (test_mode == TEST_MODE_1) {
        assert("eB" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               !flag_eC &&
               !flag_xC &&
               !flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eB" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               !flag_eC &&
               !flag_xC &&
               !flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void xB(void *ctx)
{
    flag_xB = true;

    if (test_mode == TEST_MODE_1) {
        assert("xB" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("xB" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void eC(void *ctx)
{
    flag_eC = true;

    if (test_mode == TEST_MODE_1) {
        assert("eC" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               !flag_xC &&
               !flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eC" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               !flag_xC &&
               !flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void xC(void *ctx)
{
    flag_xC = true;

    if (test_mode == TEST_MODE_1) {
        assert("xC" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("xC" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void eD(void *ctx)
{
    flag_eD = true;

    if (test_mode == TEST_MODE_1) {
        assert("eD" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               !flag_xC &&
               flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eD" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               !flag_xC &&
               flag_eD &&
               !flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void xD(void *ctx)
{
    flag_xD = true;

    if (test_mode == TEST_MODE_1) {
        assert("xD" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               !flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("xD" &&
               flag_eA &&
               !flag_xA &&
               flag_eB &&
               !flag_xB &&
               flag_eC &&
               !flag_xC &&
               flag_eD &&
               flag_xD &&
               !flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void bInit(void *ctx)
{
    flag_initB = true;
}

void cInit(void *ctx)
{
    flag_initC = true;
}

void dInit(void *ctx)
{
    flag_initD = true;
}

void eE(void *ctx)
{
    flag_eE = true;

    if (test_mode == TEST_MODE_1) {
        assert("eE" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eE" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               !flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void eF(void *ctx)
{
    flag_eF = true;

    if (test_mode == TEST_MODE_1) {
        assert("eF" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eF" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               flag_eF &&
               !flag_xF &&
               !flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void eG(void *ctx)
{
    flag_eG = true;

    if (test_mode == TEST_MODE_1) {
        assert("eG" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               flag_eF &&
               !flag_xF &&
               flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               flag_initF &&
               flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eE" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               flag_eF &&
               !flag_xF &&
               flag_eG &&
               !flag_xG &&
               !flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void eH(void *ctx)
{
    flag_eH = true;

    if (test_mode == TEST_MODE_1) {
        assert("eH" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               flag_eF &&
               !flag_xF &&
               flag_eG &&
               !flag_xG &&
               flag_eH &&
               !flag_xH &&
               flag_initB &&
               flag_initC &&
               flag_initD &&
               flag_initF &&
               flag_initG &&
               flag_initH &&
               !flag_eEnd);
    } else if (test_mode == TEST_MODE_2) {
        assert("eE" &&
               flag_eA &&
               flag_xA &&
               flag_eB &&
               flag_xB &&
               flag_eC &&
               flag_xC &&
               flag_eD &&
               flag_xD &&
               flag_eE &&
               !flag_xE &&
               flag_eF &&
               !flag_xF &&
               flag_eG &&
               !flag_xG &&
               flag_eH &&
               !flag_xH &&
               !flag_initB &&
               !flag_initC &&
               !flag_initD &&
               !flag_initF &&
               !flag_initG &&
               !flag_initH &&
               !flag_eEnd);
    } else {
        assert(false);
    }
}

void initH(void *ctx)
{
    flag_initH = true;
}

void initG(void *ctx)
{
    flag_initG = true;
}

void initF(void *ctx)
{
    flag_initF = true;
}

void eEnd(void *ctx)
{
    flag_eEnd = true;
}


int main(void) 
{
    int rc;
    struct test_nested_states_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    test_mode = TEST_MODE_1;
    reset_flags();

    test_nested_states_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eStart);
    assert(rc == 0);
    rc = ufsm_process(m, eStop);
    assert(rc == 0);


    test_mode = TEST_MODE_2;
    reset_flags();

    test_nested_states_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eStart2);
    assert(rc == 0);
    rc = ufsm_process(m, eStop2);
    assert(rc == 0);
    return 0;
}
