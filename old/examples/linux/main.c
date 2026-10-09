#include <stdio.h>
#include <assert.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/epoll.h>
#include <sys/timerfd.h>

#include "linux_async.h"
#include "queue.h"
#include "timer.h"

#define MAX_EVENTS 16

struct private_ctx {
    struct ufsm_queue *q;
    struct ufsm_timer tmr, tmr_exit;
    int epoll_fd;
    bool run;
};

void enter_inactive(void *context)
{
    printf("%s\n", __func__);
}

void enter_active(void *context)
{
    printf("%s\n", __func__);
}

void do_cleanup(void *context)
{
    printf("%s\n", __func__);
}

void do_work(void *context)
{
    printf("%s\n", __func__);
}

void enter_idle(void *context)
{
    printf("%s\n", __func__);
}

void exit_program(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    priv->run = false;
    printf("%s\n", __func__);
}

void start_exit_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_start(&priv->tmr_exit);
    printf("%s\n", __func__);
}

void cancel_exit_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_cancel(&priv->tmr_exit);
    printf("%s\n", __func__);
}

void start_init_delay_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_start(&priv->tmr);
    printf("%s\n", __func__);
}

void cancel_init_delay_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_cancel(&priv->tmr);
    printf("%s\n", __func__);
}

int main(int argc, char **argv)
{
    struct epoll_event events[MAX_EVENTS];
    struct linux_async_machine m;
    struct private_ctx priv;
    struct ufsm_queue *q;
    int rc = 0;

    priv.run = true;
    priv.epoll_fd = epoll_create1(0);

    if (priv.epoll_fd == -1) {
        fprintf(stderr, "Failed to create epoll fd\n");
        rc = -1;
        goto err_out;
    }

    /* Initialize the queue to hold 128 int's */
    q = ufsm_queue_init(priv.epoll_fd, 128);
    priv.q = q;

    ufsm_timer_init(&priv.tmr, priv.epoll_fd, q, 1500, eEnable);
    ufsm_timer_init(&priv.tmr_exit, priv.epoll_fd, q, 5000, eExitTimerExpired);

    linux_async_init(&m, &priv);
    linux_async_process(&m, UFSM_RESET);

    for (;;) {
        int no_of_fds = epoll_wait(priv.epoll_fd, events, MAX_EVENTS, -1);

        if (no_of_fds == -1) {
            fprintf(stderr, "epoll_wait failed\n");
            rc = -1;
            goto err_free_timers_out;
        }

        for (int n = 0; n < no_of_fds; n++) {
            int fd = events[n].data.fd;

            if (ufsm_timer_get_fd(&priv.tmr) == fd) {
                ufsm_timer_handle(&priv.tmr);
            } else if (ufsm_timer_get_fd(&priv.tmr_exit) == fd) {
                ufsm_timer_handle(&priv.tmr_exit);
            } else if (ufsm_queue_get_fd(q) == fd) {
                uint64_t no_of_queue_events;

                if (ufsm_queue_handle(q, &no_of_queue_events) != 0) {
                    fprintf(stderr, "Failed to read queue events\n");
                    priv.run = false;
                    rc = -1;
                    break;
                }

                for (int i = 0; i < no_of_queue_events; i++) {
                    assert(linux_async_process(&m, ufsm_queue_pop(q)) == 0);
                }
            }
        }

        if (!priv.run) {
            printf("Exiting...\n");
            break;
        }
    }

err_free_timers_out:
    ufsm_timer_free(&priv.tmr);
    ufsm_timer_free(&priv.tmr_exit);
    ufsm_queue_free(q);
    close(priv.epoll_fd);
err_out:
    return rc;
}

