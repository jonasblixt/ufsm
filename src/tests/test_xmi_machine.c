#include <stdio.h>
#include <ufsm.h>
#include <test_xmi_machine_input.h>

bool Guard(void)
{
    printf ("Guard called\n");
    return true;
}

void DoAction(void)
{
    printf ("DoAction called\n");
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
 
    printf ("m: %p\n",m);
    ufsm_init(m);
        
    ufsm_process (m, EV_D);
    ufsm_process (m, EV_B);

    ufsm_process (m, EV_E);
    ufsm_process (m, EV_B);
    ufsm_process (m, EV_A);


    return 0;
}
