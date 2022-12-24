#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_init_to_nested.h"

void eA(void *user) { ufsm_test_rec(__func__); }
void eB1(void *user) { ufsm_test_rec(__func__); }

void B2Init(void *user) { ufsm_test_rec(__func__); }
void B1Init(void *user) { ufsm_test_rec(__func__); }
void eB2(void *user) { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_init_to_nested_machine m = {0};

    UFSM_TEST(test_init_to_nested, UFSM_RESET, "eA", "eB");
    return 0;
}
