#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_final.h"

void eA(void *user)  { ufsm_test_rec(__func__); }
void xA(void *user)  { ufsm_test_rec(__func__); }
void eA1(void *user)  { ufsm_test_rec(__func__); }
void xA1(void *user)  { ufsm_test_rec(__func__); }
void eA2(void *user)  { ufsm_test_rec(__func__); }
void xA2(void *user)  { ufsm_test_rec(__func__); }
void eB(void *user)  { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_final_machine m = {0};

    UFSM_TEST(test_final, UFSM_RESET, "eA", "eA1", "eA2");
    UFSM_TEST(test_final, e1, NULL);

    return 0;
}
