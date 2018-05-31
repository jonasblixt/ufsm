#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_join_input.h>
#include "common.h"

static bool flag_final = false;

void final(void)
{
    flag_final = true;
}

void eAB(void)
{
}

void xAB(void)
{
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    test_init(m);
    ufsm_init_machine(m);

    test_process(m, EV);

    test_process(m, EV);

    test_process(m, EV);


    assert (flag_final);
    return 0;
}
