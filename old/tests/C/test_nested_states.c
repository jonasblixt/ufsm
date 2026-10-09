#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_nested_states.h"

void eA(void *user) { ufsm_test_rec(__func__); }

void eF(void *user) { ufsm_test_rec(__func__); }
void eG(void *user) { ufsm_test_rec(__func__); }
void xD(void *user) { ufsm_test_rec(__func__); }
void xB(void *user) { ufsm_test_rec(__func__); }
void eB(void *user) { ufsm_test_rec(__func__); }
void eD(void *user) { ufsm_test_rec(__func__); }
void xC(void *user) { ufsm_test_rec(__func__); }
void xA(void *user) { ufsm_test_rec(__func__); }
void eC(void *user) { ufsm_test_rec(__func__); }
void eH(void *user) { ufsm_test_rec(__func__); }
void eE(void *user) { ufsm_test_rec(__func__); }

void BInit(void *user) { ufsm_test_rec(__func__); }

void CInit(void *user) { ufsm_test_rec(__func__); }
void DInit(void *user) { ufsm_test_rec(__func__); }
void FInit(void *user) { ufsm_test_rec(__func__); }
void GInit(void *user) { ufsm_test_rec(__func__); }
void HInit(void *user) { ufsm_test_rec(__func__); }
void StartInit(void *user) { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_nested_states_machine m = {0};

    UFSM_TEST(test_nested_states, UFSM_RESET, "StartInit");
    UFSM_TEST(test_nested_states, eStart2, "eA", "eB", "eC", "eD");

    UFSM_TEST(test_nested_states, UFSM_RESET, "StartInit");
    UFSM_TEST(test_nested_states, eStart, "eA", "BInit", "eB", "CInit", "eC", "DInit", "eD");

    UFSM_TEST(test_nested_states, UFSM_RESET, "StartInit");
    UFSM_TEST(test_nested_states, eStart2, "eA", "eB", "eC", "eD");
    UFSM_TEST(test_nested_states, eStop, "xD", "xC", "xB", "xA", "eE", "FInit", "eF", "GInit", "eG", "HInit", "eH");

    UFSM_TEST(test_nested_states, UFSM_RESET, "StartInit");
    UFSM_TEST(test_nested_states, eStart2, "eA", "eB", "eC", "eD");
    UFSM_TEST(test_nested_states, eStop2, "xD", "xC", "xB", "xA", "eE", "eF", "eG", "eH");
    return 0;
}
