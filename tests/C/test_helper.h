#ifndef UFSM_TEST_HELPER_H
#define UFSM_TEST_HELPER_H

#include <stdbool.h>

#define UFSM_TEST(__machine_name, __event, ...) \
    { \
        printf("-> " #__event "\n"); \
        ufsm_test_reset(); \
        const char *exp[] = {__VA_ARGS__, NULL}; \
        __machine_name##_process(&m, __event); \
        assert (ufsm_test_check(exp) && #__machine_name); \
    }

void ufsm_test_reset(void);
void ufsm_test_rec(const char *func_name);
bool ufsm_test_check(const char *expected[]);

#endif
