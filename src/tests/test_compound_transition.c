#include <stdio.h>
#include <ufsm.h>
#include <assert.h>
#include <test_compound_transition_input.h>

static bool flag_eT1 = false;
static bool flag_eT11 = false;
static bool flag_eT111 = false;
static bool flag_xS1 = false;
static bool flag_xS11 = false;

static void reset_flags(void)
{
    flag_eT1 = false;
    flag_eT11 = false;
    flag_eT111 = false;
    flag_xS1 = false;
    flag_xS11 = false;
}

void eT1(void)
{
    printf(" eT1 \n");
    assert (flag_xS1 && flag_xS11);
    flag_eT1 = true;
}

void eT11(void)
{
    printf(" eT11 \n");
    assert (flag_eT1);
    flag_eT11 = true;
}

void eT111(void)
{
    printf (" eT111 \n");
    assert (flag_eT1 && flag_eT11);
    flag_eT111 = true;
}

void xS1(void)
{
    printf(" xS1 \n");
    assert (flag_xS11);
    flag_xS1 = true;
}

void xS11(void)
{
    printf (" xS11 \n");
 
    assert(!flag_eT1 && !flag_eT11 && !flag_eT111);
    assert(!flag_xS1 && !flag_xS11);


    flag_xS11 = true;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
 
    reset_flags();
    ufsm_init(m);
    
    assert(!flag_eT1 && !flag_eT11 && !flag_eT111);
    assert(!flag_xS1 && !flag_xS11);

    reset_flags();
    ufsm_process(m, sig);       
    assert(flag_xS1 && flag_xS11);
    assert(flag_eT1 && flag_eT11 && flag_eT111);
 

    return 0;
}
