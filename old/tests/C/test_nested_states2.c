#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_states2.h"

void eA(void *user) { ufsm_test_rec(__func__); }
void xA(void *user) { ufsm_test_rec(__func__); }
void eB(void *user) { ufsm_test_rec(__func__); }
void xB(void *user) { ufsm_test_rec(__func__); }
void eC1(void *user) { ufsm_test_rec(__func__); }
void xC1(void *user) { ufsm_test_rec(__func__); }
void eC2(void *user) { ufsm_test_rec(__func__); }
void xC2(void *user) { ufsm_test_rec(__func__); }
void eD(void *user) { ufsm_test_rec(__func__); }
void xD(void *user) { ufsm_test_rec(__func__); }
void eE(void *user) { ufsm_test_rec(__func__); }
void xE(void *user) { ufsm_test_rec(__func__); }
void eF(void *user) { ufsm_test_rec(__func__); }
void xF(void *user) { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_nested_states2_machine m = {0};

    UFSM_TEST(test_nested_states2, UFSM_RESET, NULL);
    UFSM_TEST(test_nested_states2, eStart, "eA", "eB", "eC1", "eC2");
    UFSM_TEST(test_nested_states2, eStop, "xC2", "xC1", "xB", "xA", "eD", "eE", "eF");
    return 0;
}
