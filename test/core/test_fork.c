#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_fork.gen.h"

static bool gA_val = false;
static bool g2_val = false;
static bool flag_gA = false;
static bool flag_g2 = false;
static bool flag_finalD = false;
static bool flag_eD = false;
static bool flag_eC = false;
static bool flag_finalC = false;
static bool flag_eB2 = false;
static bool flag_xB2 = false;
static bool flag_eA2 = false;
static bool flag_xA2 = false;
static bool flag_eAB = false;
static bool flag_xAB = false;
static uint32_t ab_exit_cnt = 0;

void reset_flags(void)
{
    flag_gA = false;
    flag_g2 = false;
    flag_finalC = false;
    flag_eB2 = false;
    flag_xB2 = false;
    flag_eA2 = false;
    flag_xA2 = false;
    flag_eAB = false;
    flag_xAB = false;
}

bool gA(void *ctx) { flag_gA = true; return gA_val; }
bool g2(void *ctx) { flag_g2 = true; return g2_val; }
void finalC(void *ctx) { flag_finalC = true; }
void eB2(void *ctx) { flag_eB2 = true; }
void xB2(void *ctx) { flag_xB2 = true; }
void eA2(void *ctx) { flag_eA2 = true; }
void xA2(void *ctx) { flag_xA2 = true; }
void eAB(void *ctx) { flag_eAB = true; }
void xAB(void *ctx) { ab_exit_cnt++; flag_xAB = true; }

int main(void)
{
    int rc;
    struct test_fork_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();
    test_fork_machine_initialize(&machine, NULL);

    assert ("step1" &&
            !flag_gA &&
            !flag_g2 &&
            !flag_finalC &&
            !flag_eB2 &&
            !flag_xB2 &&
            !flag_eA2 &&
            !flag_xA2 &&
            !flag_eAB &&
            !flag_xAB);

    g2_val = true;
    gA_val = false;
    rc = ufsm_process(m, EV);
    assert(rc == 0);

    assert ("step2" &&
            flag_gA &&
            flag_g2 &&
            !flag_finalC &&
            flag_eB2 &&
            !flag_xB2 &&
            flag_eA2 &&
            !flag_xA2 &&
            flag_eAB &&
            !flag_xAB);

    reset_flags();
    rc = ufsm_process(m, EV);
    assert(rc == 0);

    assert ("step3" &&
            !flag_gA &&
            !flag_g2 &&
            flag_finalC &&
            !flag_eB2 &&
            flag_xB2 &&
            !flag_eA2 &&
            flag_xA2 &&
            !flag_eAB &&
            flag_xAB);

    assert ("step4" && ab_exit_cnt == 1);

    reset_flags();
    test_fork_machine_initialize(&machine, NULL);

    g2_val = false;
    gA_val = true;
    rc = ufsm_process(m, EV);
    assert(rc == 0);

    assert ("step5" &&
            flag_gA &&
            !flag_g2 &&
            !flag_finalC &&
            !flag_eB2 &&
            !flag_xB2 &&
            !flag_eA2 &&
            !flag_xA2 &&
            flag_eAB &&
            !flag_xAB);

    return 0;
}
