#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_states3.h"

void eB(void *user)  { ufsm_test_rec(__func__); }
void eB1(void *user) { ufsm_test_rec(__func__); }
void eB2(void *user) { ufsm_test_rec(__func__); }
void xB2(void *user) { ufsm_test_rec(__func__); }
void xB1(void *user) { ufsm_test_rec(__func__); }
void xB(void *user) { ufsm_test_rec(__func__); }
void eB11(void *user) { ufsm_test_rec(__func__); }
void eB20(void *user) { ufsm_test_rec(__func__); }
void xB11(void *user) { ufsm_test_rec(__func__); }

void main(void)
{
    struct test_nested_states3_machine m = {0};

    {
        printf("-> Reset\n");
        ufsm_test_reset();
        const char *exp[] = {NULL};
        test_nested_states3_process(&m, UFSM_RESET);
        assert (ufsm_test_check(exp) && "reset");
    }

    {
        printf("-> eStart\n");
        ufsm_test_reset();
        const char *exp[] = {"eB", "eB20", "eB1", "eB11", "eB2", NULL};
        test_nested_states3_process(&m, eStart);
        assert (ufsm_test_check(exp) && "eStart");
    }

    {
        printf("-> eStop\n");
        ufsm_test_reset();
        const char *exp[] = {"xB11", "xB2", "xB1", "xB", NULL};
        test_nested_states3_process(&m, eStop);
        assert (ufsm_test_check(exp) && "eStop");
    }
}
