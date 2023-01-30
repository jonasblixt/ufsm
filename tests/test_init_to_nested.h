/* Autogenerated with uFSM */
#ifndef UFSM_TEST_INIT_TO_NESTED
#define UFSM_TEST_INIT_TO_NESTED

#define UFSM_OK 0
#define UFSM_BAD_ARGUMENT 1
#define UFSM_SIGNAL_QUEUE_FULL 2

/* Events */
#define UFSM_RESET 0
#define UFSM_AUTO_TRANSITION 1

/* Signals */

/* Guard prototypes */

/* Action prototypes */
void eA(void *user);
void eB1(void *user);
void B2Init(void *user);
void B1Init(void *user);
void eB2(void *user);

struct test_init_to_nested_machine {
    unsigned int csv[3];
    unsigned int wsv[3];
    unsigned int signal[16];
    unsigned int head;
    unsigned int tail;
    void *user;
};

int test_init_to_nested_init(struct test_init_to_nested_machine *m, void *user);
int test_init_to_nested_process(struct test_init_to_nested_machine *m, unsigned int event);

#endif  // UFSM_TEST_INIT_TO_NESTED
