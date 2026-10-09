#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_fork_join.h"

void eB(void *user) { ufsm_test_rec(__func__); }
void xB(void *user) { ufsm_test_rec(__func__); }
void eEnd(void *user) { ufsm_test_rec(__func__); }
void eB1(void *user) { ufsm_test_rec(__func__); }
void xB1(void *user) { ufsm_test_rec(__func__); }
void eB11(void *user) { ufsm_test_rec(__func__); }
void xB11(void *user) { ufsm_test_rec(__func__); }
void eB2(void *user) { ufsm_test_rec(__func__); }
void xB2(void *user) { ufsm_test_rec(__func__); }
void eStart(void *user) { ufsm_test_rec(__func__); }
void xStart(void *user) { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_fork_join_machine m = {0};

    {
        printf("-> Reset\n");
        ufsm_test_reset();
        const char *exp[] = {"eStart", NULL};
        test_fork_join_process(&m, UFSM_RESET);
        assert (ufsm_test_check(exp) && "reset");
    }

    {
        printf("-> eEvent2\n");
        ufsm_test_reset();
        const char *exp[] = {NULL};
        test_fork_join_process(&m, eEvent2);
        assert (ufsm_test_check(exp) && "eEvent2");
    }

    {
        printf("-> eBegin\n");
        ufsm_test_reset();
        const char *exp[] = {"xStart", "eB", "eB1", "eB2", NULL};
        test_fork_join_process(&m, eBegin);
        assert (ufsm_test_check(exp) && "eBegin");
    }

    {
        printf("-> eEvent2\n");
        ufsm_test_reset();
        const char *exp[] = {NULL};
        test_fork_join_process(&m, eEvent2);
        assert (ufsm_test_check(exp) && "eEvent2");
    }

    {
        printf("-> eEvent\n");
        ufsm_test_reset();
        const char *exp[] = {"xB1", "eB11", NULL};
        test_fork_join_process(&m, eEvent);
        assert (ufsm_test_check(exp) && "eEvent");
    }

    {
        printf("-> eEvent2\n");
        ufsm_test_reset();
        const char *exp[] = {"xB2", "xB11", "xB", "eEnd", NULL};
        test_fork_join_process(&m, eEvent2);
        assert (ufsm_test_check(exp) && "eEvent2");
    }
    return 0;
}
