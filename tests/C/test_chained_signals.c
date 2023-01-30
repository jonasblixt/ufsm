#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_chained_signals.h"

void eA(void *user)  { ufsm_test_rec(__func__); }
void xA(void *user)  { ufsm_test_rec(__func__); }

void eB(void *user)  { ufsm_test_rec(__func__); }
void xB(void *user)  { ufsm_test_rec(__func__); }

void eC(void *user)  { ufsm_test_rec(__func__); }
void xC(void *user)  { ufsm_test_rec(__func__); }

void eD(void *user)  { ufsm_test_rec(__func__); }
void xD(void *user)  { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_chained_signals_machine m = {0};

    UFSM_TEST(test_chained_signals, UFSM_RESET, "eA");
    UFSM_TEST(test_chained_signals, e1, "xA", "eB", "xB", "eC", "xC", "eD", "xD", "eC");

    return 0;
}
