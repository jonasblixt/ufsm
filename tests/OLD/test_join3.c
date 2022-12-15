#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>
#include "test_join3.gen.h"

static bool f_error, f_completed, f_join_enter, f_join_exit,
            f_worker_thread1_start, f_worker_thread1_join,
            f_worker_thread2_start, f_worker_thread2_join;

static void reset_flags(void)
{
    f_error = false;
    f_completed = false;
    f_join_enter = false;
    f_join_exit = false;
    f_worker_thread1_start = false;
    f_worker_thread1_join = false;
    f_worker_thread2_start = false;
    f_worker_thread2_join = false;
}

void handle_error(void *ctx)
{
    f_error = true;
}

void completed(void *ctx)
{
    f_completed = true;
}

void join_enter(void *ctx)
{
    f_join_enter = true;
}

void join_exit(void *ctx)
{
    f_join_exit = true;
}

void start_worker_thread1(void *ctx)
{
    f_worker_thread1_start = true;
}

void join_worker_thread1(void *ctx)
{
    f_worker_thread1_join = true;
}

void start_worker_thread2(void *ctx)
{
    f_worker_thread2_start = true;
}

void join_worker_thread2(void *ctx)
{
    f_worker_thread2_join = true;
}


int main(void) 
{
    int rc;
    struct test_join_machine machine;
    struct ufsm_machine *m = &machine.machine;
    ufsm_debug_machine(&machine.machine);

    reset_flags();
    test_join_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eWork1Done);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed);

    rc = ufsm_process(m, eWork2Done);
    assert(rc == 0);
    assert(f_worker_thread2_join && f_completed);

    /* Test error handler */
    reset_flags();
    test_join_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eWork1Done);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed);

    rc = ufsm_process(m, eError);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed && f_error);

    rc = ufsm_process(m, eWork2Done);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed && f_worker_thread2_join);

    rc = ufsm_process(m, eReset);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed && f_worker_thread2_join);

    rc = ufsm_process(m, eWork2Done);
    assert(rc == 0);
    assert(!f_completed);


    rc = ufsm_process(m, eWork1Done);
    assert(rc == 0);
    assert(f_completed);

    /* Test reset from completion  */
    reset_flags();
    test_join_machine_initialize(&machine, NULL);

    rc = ufsm_process(m, eWork1Done);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed);

    rc = ufsm_process(m, eWork2Done);
    assert(rc == 0);
    assert(f_worker_thread2_join && f_completed);

    reset_flags();
    rc = ufsm_process(m, eReset);
    assert(rc == 0);
    assert(!f_completed);

    rc = ufsm_process(m, eWork1Done);
    assert(rc == 0);
    assert(f_worker_thread1_join && !f_completed);

    rc = ufsm_process(m, eWork2Done);
    assert(rc == 0);
    assert(f_worker_thread2_join && f_completed);
    return 0;
}
