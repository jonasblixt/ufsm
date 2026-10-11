#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_state_conditions.h"

void eMode1(void *user) { ufsm_test_rec(__func__); }
void xMode1(void *user) { ufsm_test_rec(__func__); }
void eMode2(void *user) { ufsm_test_rec(__func__); }
void xMode2(void *user) { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_state_conditions_machine m = {0};

    UFSM_TEST(test_state_conditions, UFSM_RESET, "eMode1");
    UFSM_TEST(test_state_conditions, eSwitchMode, NULL);
    UFSM_TEST(test_state_conditions, eToggle, NULL);
    UFSM_TEST(test_state_conditions, eSwitchMode, "xMode1", "eMode2");
    return 0;
}
