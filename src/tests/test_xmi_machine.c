#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <assert.h>
#include <test_xmi_machine_input.h>
#include "common.h"

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


bool Guard(void)
{
    return true;
}

void DoAction(void)
{
}

void eD(void)
{
    flag_eD = true;
}

void eC(void)
{
    flag_eC = true;
}

void t1(void)
{
    flag_t1 = true;
}

void t2(void)
{
    flag_t2 = true;
}

void t3(void)
{
    flag_t3 = true;
}

void final(void)
{
    flag_final = true;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    uint32_t err = UFSM_OK;
 
    m->debug_transition = &debug_transition;
    m->debug_enter_region = &debug_enter_region;
    m->debug_leave_region = &debug_leave_region;
    m->debug_event = &debug_event;
    m->debug_action = &debug_action;
    m->debug_guard = &debug_guard;

    assert (ufsm_init_machine(m) == UFSM_OK);
    assert (flag_eC);

    reset_flags();
    test_process (m, EV_D);
    test_process (m, EV_B);

    test_process (m, EV_E);
    test_process (m, EV_B);
    test_process (m, EV_A);
    assert(flag_eD);
    
    reset_flags();
    test_process (m, EV_B);
    test_process (m, EV_E);
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
