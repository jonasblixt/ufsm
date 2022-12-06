#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_states4.h"

void eA(void *user)  { ufsm_test_rec(__func__); }
void xA(void *user)  { ufsm_test_rec(__func__); }
void eB(void *user)  { ufsm_test_rec(__func__); }
void xB(void *user)  { ufsm_test_rec(__func__); }
void eB1(void *user)  { ufsm_test_rec(__func__); }
void xB1(void *user)  { ufsm_test_rec(__func__); }
void eC(void *user)  { ufsm_test_rec(__func__); }
void xC(void *user)  { ufsm_test_rec(__func__); }
void eD(void *user)  { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_nested_states4_machine m = {0};

    {
        printf("-> Reset\n");
        ufsm_test_reset();
        const char *exp[] = {"eA", NULL};
        test_nested_states4_process(&m, UFSM_RESET);
        assert (ufsm_test_check(exp) && "reset");
    }

    {
        printf("-> eEvent\n");
        ufsm_test_reset();
        const char *exp[] = {"xA", "eB", "eB1", "xB1", "xB", "eC", "xC", "eD", NULL};
        test_nested_states4_process(&m, eEvent);
        assert (ufsm_test_check(exp) && "eEvent");
    }

    return 0;
}
