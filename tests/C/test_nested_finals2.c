#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_finals2.h"

void eA(void *user)  { ufsm_test_rec(__func__); }
void xA(void *user)  { ufsm_test_rec(__func__); }
void eA1(void *user)  { ufsm_test_rec(__func__); }
void xA1(void *user)  { ufsm_test_rec(__func__); }
void eA11(void *user)  { ufsm_test_rec(__func__); }
void xA11(void *user)  { ufsm_test_rec(__func__); }
void eEnd(void *user)  { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_nested_finals2_machine m = {0};

    UFSM_TEST(test_nested_finals2, UFSM_RESET, "eA", "eA1", "eA11");
    UFSM_TEST(test_nested_finals2, e1, "xA11", "xA1", "xA", "eEnd");

    return 0;
}
