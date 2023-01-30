#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_composits.h"

void eInitA(void *user) { ufsm_test_rec(__func__); }
void xInitA(void *user) { ufsm_test_rec(__func__); }
void eA12dummy(void *user) { ufsm_test_rec(__func__); }
void xA12dummy(void *user) { ufsm_test_rec(__func__); }
void eB(void *user) { ufsm_test_rec(__func__); }
void eAEnd(void *user) { ufsm_test_rec(__func__); }
void eA11(void *user) { ufsm_test_rec(__func__); }
void xA11(void *user) { ufsm_test_rec(__func__); }
void eA12(void *user) { ufsm_test_rec(__func__); }
void xA12(void *user) { ufsm_test_rec(__func__); }
void eA13(void *user) { ufsm_test_rec(__func__); }
void xA13(void *user) { ufsm_test_rec(__func__); }
void eA22(void *user) { ufsm_test_rec(__func__); }
void xA22(void *user) { ufsm_test_rec(__func__); }
void eA21(void *user) { ufsm_test_rec(__func__); }
void xA21(void *user) { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_nested_composits_machine m;
    test_nested_composits_init(&m, NULL);
    UFSM_TEST(test_nested_composits, UFSM_RESET, "eInitA", "eA21");
    UFSM_TEST(test_nested_composits, EV3, "xA21", "eA22");
    UFSM_TEST(test_nested_composits, EV, "xInitA", "eA11", "eA12", "eA13");
    UFSM_TEST(test_nested_composits, EV_B, "xA13", "xA12", "xA11", "xA22", "eB");

    UFSM_TEST(test_nested_composits, UFSM_RESET, "eInitA", "eA21");
    UFSM_TEST(test_nested_composits, EV3, "xA21", "eA22");
    UFSM_TEST(test_nested_composits, EV, "xInitA", "eA11", "eA12", "eA13");
    UFSM_TEST(test_nested_composits, EV2, "xA12", "eA12dummy", "xA13", "xA12dummy", "xA11", "eAEnd");
    return 0;
}
