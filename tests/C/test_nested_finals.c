#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_finals.h"

void eA(void *user)  { ufsm_test_rec(__func__); }
void xA(void *user)  { ufsm_test_rec(__func__); }
void eA11(void *user)  { ufsm_test_rec(__func__); }
void xA11(void *user)  { ufsm_test_rec(__func__); }
void eA12(void *user)  { ufsm_test_rec(__func__); }
void xA12(void *user)  { ufsm_test_rec(__func__); }
void eA121(void *user)  { ufsm_test_rec(__func__); }
void xA121(void *user)  { ufsm_test_rec(__func__); }
void eEnd(void *user)  { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_nested_finals_machine m = {0};

    UFSM_TEST(test_nested_finals, UFSM_RESET, "eA", "eA11", "eA12", "eA121");
    UFSM_TEST(test_nested_finals, e1, "xA11", "xA121", "xA12", "xA", "eEnd");

    UFSM_TEST(test_nested_finals, UFSM_RESET, "eA", "eA11", "eA12", "eA121");
    UFSM_TEST(test_nested_finals, e2, "xA121");
    UFSM_TEST(test_nested_finals, e1, "xA11", "xA12", "xA", "eEnd");
    return 0;
}
