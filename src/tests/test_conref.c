#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_conref_input.h>
#include "common.h"

static uint32_t eAc = 0;
static uint32_t eCc = 0;
static uint32_t t0c = 0;
static uint32_t t4c = 0;
static uint32_t t3c = 0;
static uint32_t t1c = 0;
static uint32_t xSAc = 0;
static uint32_t eSAc = 0;
static uint32_t xBc = 0;
static uint32_t eBc = 0;

void eA(void)
{
    eAc++;
}

void eC(void)
{
    eCc++;
}

void t0(void)
{
    t0c++;
}

void t4(void)
{
    t4c++;
}

void t3(void)
{
    t3c++;
}

void t1(void)
{
    t1c++;
}

void xSA(void)
{
    xSAc++;
}

void eSA(void)
{
    eSAc++;
}

void xB(void)
{
    xBc++;
}

void eB(void)
{
    eBc++;
}

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    test_init(m);
    ufsm_init_machine(m);

    assert (eAc == 1 &&
            eCc == 0 &&
            t0c == 0 &&
            t1c == 0 &&
            t3c == 0 &&
            t4c == 0 &&
            xSAc == 0 &&
            eSAc == 0 &&
            xBc == 0 &&
            eBc == 0);
            

    test_process(m, EV1);  


    assert (eAc == 1 &&
            eCc == 0 &&
            t0c == 1 &&
            t1c == 0 &&
            t3c == 1 &&
            t4c == 0 &&
            xSAc == 0 &&
            eSAc == 1 &&
            xBc == 0 &&
            eBc == 1);
            

    test_process(m, EV1);


    assert (eAc == 1 &&
            eCc == 1 &&
            t0c == 1 &&
            t1c == 1 &&
            t3c == 1 &&
            t4c == 1 &&
            xSAc == 1 &&
            eSAc == 1 &&
            xBc == 1 &&
            eBc == 1);
            
    return 0;
}
