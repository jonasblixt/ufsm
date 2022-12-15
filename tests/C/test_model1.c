#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include "test_helper.h"
#include "gen/test_model1.h"

void eA(void *user) { ufsm_test_rec(__func__); }
void xA(void *user) { ufsm_test_rec(__func__); }
void eC1(void *user) { ufsm_test_rec(__func__); }
void xC1(void *user) { ufsm_test_rec(__func__); }
void eC11(void *user) { ufsm_test_rec(__func__); }
void xC11(void *user) { ufsm_test_rec(__func__); }
void eC12(void *user) { ufsm_test_rec(__func__); }
void xC12(void *user) { ufsm_test_rec(__func__); }
void eB(void *user) { ufsm_test_rec(__func__); }
void xB(void *user) { ufsm_test_rec(__func__); }
void eC2(void *user) { ufsm_test_rec(__func__); }
void xC2(void *user) { ufsm_test_rec(__func__); }
void eD2(void *user) { ufsm_test_rec(__func__); }
void xD2(void *user) { ufsm_test_rec(__func__); }
void eD1(void *user) { ufsm_test_rec(__func__); }
void xD1(void *user) { ufsm_test_rec(__func__); }
void eD11(void *user) { ufsm_test_rec(__func__); }
void xD11(void *user) { ufsm_test_rec(__func__); }
void eD12(void *user) { ufsm_test_rec(__func__); }
void xD12(void *user) { ufsm_test_rec(__func__); }
void eE1(void *user) { ufsm_test_rec(__func__); }
void xE1(void *user) { ufsm_test_rec(__func__); }
void eE11(void *user) { ufsm_test_rec(__func__); }
void xE11(void *user) { ufsm_test_rec(__func__); }
void eE12(void *user) { ufsm_test_rec(__func__); }
void xE12(void *user) { ufsm_test_rec(__func__); }
void o2(void *user) { ufsm_test_rec(__func__); }
void o1(void *user) { ufsm_test_rec(__func__); }

int main(int argc, char **argv)
{
    struct test_model1_machine m = {0};

    {
        printf("-> Reset\n");
        ufsm_test_reset();
        const char *exp[] = {"eA", "eC1", "eC11", NULL};
        test_model1_process(&m, UFSM_RESET);
        assert (ufsm_test_check(exp) && "reset");
    }

    {
        printf("-> e4\n");
        ufsm_test_reset();
        const char *exp[] = {"xC11", "xC1", "eC2", NULL};
        test_model1_process(&m, e4);
        assert (ufsm_test_check(exp));
    }

    {
        printf("-> e2\n");
        ufsm_test_reset();
        const char *exp[] = {"xC2", "xA", "eB", "eE1", "eD1", "eD12", "eE11", NULL};
        test_model1_process(&m, e2);
        assert (ufsm_test_check(exp));
    }

    {
        printf("-> e1\n");
        ufsm_test_reset();
        const char *exp[] = {NULL};
        test_model1_process(&m, e1);
        assert(ufsm_test_check(exp));
    }

    {
        printf("-> e7\n");
        ufsm_test_reset();
        const char *exp[] = {"xE11", "eE12", NULL};
        test_model1_process(&m, e7);
        assert(ufsm_test_check(exp));
    }

    {
        printf("-> e1\n");
        ufsm_test_reset();
        test_model1_process(&m, e1);
        const char *exp[] = { "xD12",
                                "xE12",
                                "xD1",
                                "xE1",
                                "xB",
                                "o1",
                                "eA",
                                "eC1",
                                "eC11",
                                "xC11",
                                "xC1",
                                "xA",
                                "o2",
                                "eB",
                                "eE1",
                                "eD1",
                                "eD11",
                                "eE11",
                                NULL};

        assert (ufsm_test_check(exp));
    }

    return 0;
}
