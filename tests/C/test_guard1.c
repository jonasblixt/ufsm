#include <stdio.h>
#include <assert.h>
#include "test_helper.h"
#include "gen/test_guard1.h"

static int g1v = 0;
static int g2v = 0;

int g1(void *user) { return g1v; }
int g2(void *user) { return g2v; }
void eA(void *user)  { ufsm_test_rec(__func__); }
void xA(void *user)  { ufsm_test_rec(__func__); }
void eB(void *user)  { ufsm_test_rec(__func__); }
void xB(void *user)  { ufsm_test_rec(__func__); }

int main(void)
{
    struct test_guard1_machine m = {0};

    UFSM_TEST(test_guard1, UFSM_RESET, "eA");
    UFSM_TEST(test_guard1, e1, NULL);
    UFSM_TEST(test_guard1, e2, NULL);
    g1v = 1;
    UFSM_TEST(test_guard1, e1, "xA", "eB");
    UFSM_TEST(test_guard1, e2, NULL);
    g2v = 1;
    UFSM_TEST(test_guard1, e2, "xB", "eA");
    return 0;
}
