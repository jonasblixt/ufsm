#include <assert.h>
#include <stdio.h>
#include <test_fork_input.h>
#include <ufsm.h>
#include "common.h"

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
    flag_finalD = false;
    flag_eD = false;
    flag_eC = false;
    flag_finalC = false;
    flag_eB2 = false;
    flag_xB2 = false;
    flag_eA2 = false;
    flag_xA2 = false;
    flag_eAB = false;
    flag_xAB = false;
}

bool gA(void)
{
    flag_gA = true;
    return gA_val;
}
bool g2(void)
{
    flag_g2 = true;
    return g2_val;
}
void finalD(void) { flag_finalD = true; }
void eD(void) { flag_eD = true; }
void eC(void) { flag_eC = true; }
void finalC(void) { flag_finalC = true; }
void eB2(void) { flag_eB2 = true; }
void xB2(void) { flag_xB2 = true; }
void eA2(void) { flag_eA2 = true; }
void xA2(void) { flag_xA2 = true; }
void eAB(void) { flag_eAB = true; }
void xAB(void)
{
    ab_exit_cnt++;
    flag_xAB = true;
}

int main(void)
{
    struct ufsm_machine* m = get_StateMachine1();

    test_init(m);
    ufsm_init_machine(m);

    assert(!flag_finalD && !flag_gA && !flag_g2 && !flag_eD && !flag_eC &&
           !flag_finalC && !flag_eB2 && !flag_xB2 && !flag_eA2 && !flag_xA2 &&
           !flag_eAB && !flag_xAB);

    g2_val = true;
    gA_val = false;
    test_process(m, EV);

    assert(!flag_finalD && flag_gA && flag_g2 && !flag_eD && !flag_eC &&
           !flag_finalC && flag_eB2 && !flag_xB2 && flag_eA2 && !flag_xA2 &&
           flag_eAB && !flag_xAB);

    reset_flags();
    test_process(m, EV);

    assert(!flag_finalD && !flag_gA && !flag_g2 && !flag_eD && !flag_eC &&
           flag_finalC && !flag_eB2 && flag_xB2 && !flag_eA2 && flag_xA2 &&
           !flag_eAB && flag_xAB);

    assert(ab_exit_cnt == 1);

    ufsm_reset_machine(m);
    ufsm_init_machine(m);
    reset_flags(),

        g2_val = false;
    gA_val = true;
    test_process(m, EV);

    assert(!flag_finalD && flag_gA && !flag_g2 && !flag_eD && !flag_eC &&
           !flag_finalC && !flag_eB2 && !flag_xB2 && !flag_eA2 && !flag_xA2 &&
           flag_eAB && !flag_xAB);

    return 0;
}
