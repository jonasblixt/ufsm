#include <stdio.h>
#include <ufsm.h>
#include <test_deephistory_input.h>

void EntryActivity1(void) 
{
}

void ExitActivity1(void)
{
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
 
    ufsm_init(m);
    ufsm_process(m, EV_A);
    ufsm_process(m, EV_1);
    ufsm_process(m, EV_1);
    ufsm_process(m, EV_1);
    ufsm_process(m, EV_1);
    ufsm_process(m, EV_1);





    return 0;
}
