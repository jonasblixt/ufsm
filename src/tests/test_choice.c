#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_choice_input.h>
#include "common.h"

static bool flag_e1 = false;
static bool flag_e2 = false;
static bool flag_e3 = false;

static bool g1_val = false;
static bool g2_val = false;
static bool g3_val = false;

static void reset_flags(void)
{
    flag_e1 = false;
    flag_e2 = false;
    flag_e3 = false;
}

bool g1(void)
{
    return g1_val;
}

bool g2(void)
{
    return g2_val;
}

bool g3(void)
{
    return g3_val;
}

void e1(void)
{
    flag_e1 = true;
}

void e2(void)
{
    flag_e2 = true;
}

void e3(void)
{
    flag_e3 = true;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    test_init(m);
    ufsm_init_machine(m);

    g3_val = true;
    test_process(m, EV);
    assert (!flag_e1 && !flag_e2 && flag_e3);

    reset_flags();

    ufsm_reset_machine(m);
    ufsm_init_machine(m);
    
    g3_val = false;
    g2_val = true;
    
    test_process(m, EV);
    
    assert (!flag_e1 && flag_e2 && !flag_e3);

   
    return 0;
}
