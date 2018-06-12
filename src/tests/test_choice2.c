#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_choice2_input.h>
#include "common.h"

static bool flag_e2 = false;
static bool flag_t1 = false;
static bool flag_t2 = false;

void e2(void)
{
    flag_e2 = true;
}

bool g(void)
{
    return true;
}

void t1(void)
{
    flag_t1 = true;
}

void t2(void)
{
    flag_t2 = true;
}


int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    test_init(m);
    ufsm_init_machine(m);
    
    test_process(m,EV);

    assert ( !flag_e2 && flag_t1 && flag_t2);
   
    return 0;
}
