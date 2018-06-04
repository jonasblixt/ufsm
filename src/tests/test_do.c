#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_do_input.h>
#include "common.h"

static bool flag_final = false;

void xA(void)
{
}

void eA(void)
{
}

void dA(struct ufsm_machine *m,
        struct ufsm_state *s,
        ufsm_doact_cb_t cb)
{
    
    cb(m,s);
}

void final(void)
{
    flag_final = true;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    test_init(m);
    ufsm_init_machine(m);

    assert(flag_final);
    return 0;
}
