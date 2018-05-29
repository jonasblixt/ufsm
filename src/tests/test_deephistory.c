#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_deephistory_input.h>
#include "common.h"

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

void final(void)
{
    flag_final = true;
}

void eB(void)
{
    flag_eB = true;
}

void eA2(void)
{
    flag_eA2 = true;
}

void xA2(void)
{
    flag_xA2 = true;
}

void eA1(void)
{
    flag_eA1 = true;
}

void xA1(void)
{
    flag_xA1 = true;
}

void eE(void)
{
    flag_eE = true;
}

void xE(void)
{
    flag_xE = true;
}

void eD(void)
{
    flag_eD = true;
}

void xD(void)
{
    flag_xD = true;
}

void eC(void)
{
    flag_eC = true;
}

void xC(void)
{
    flag_xC = true;
}

void eA(void)
{
    flag_eA = true;
}

void xA(void)
{
    flag_xA = true;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    m->debug_transition = &debug_transition;
    m->debug_enter_region = &debug_enter_region;
    m->debug_leave_region = &debug_leave_region;
    m->debug_event = &debug_event;
    m->debug_action = &debug_action;
    m->debug_guard = &debug_guard;

    ufsm_init_machine(m);
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
    test_process(m, EV_A);
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


    test_process(m, EV_1);
    test_process(m, EV_1);
    test_process(m, EV_1);

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
    test_process(m, EV_B);


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

    printf (" -- Trying to recover deep history --\n");
    reset_flags();
    test_process(m, EV_A);


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
    test_process(m, EV_1);


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

    
    test_process(m ,EV_1);
    reset_flags();
    test_process(m, EV_EXIT);

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
