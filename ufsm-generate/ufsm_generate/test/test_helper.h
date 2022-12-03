#ifndef UFSM_TEST_HELPER_H
#define UFSM_TEST_HELPER_H

#include <stdbool.h>

void ufsm_test_reset(void);
void ufsm_test_rec(const char *func_name);
bool ufsm_test_check(const char *expected[]);

#endif
