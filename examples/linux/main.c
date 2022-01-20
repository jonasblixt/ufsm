#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/epoll.h>
#include <sys/timerfd.h>
#include <ufsm/ufsm.h>

#include "emit.h"
#include "queue.h"
#include "timer.h"

#define MAX_EVENTS 16

struct private_ctx {
    struct ufsm_queue *q;
    struct ufsm_timer tmr, tmr_exit;
    int epoll_fd;
    bool run;
};

void do_cleanup(void *context)
{
}

void do_work(void *context)
{
}

void enter_idle(void *context)
{
}

void exit_program(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    priv->run = false;
}

void start_exit_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_start(&priv->tmr_exit);
}

void cancel_exit_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_cancel(&priv->tmr_exit);
}

void start_init_delay_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_start(&priv->tmr);
}

void cancel_init_delay_timer(void *context)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_timer_cancel(&priv->tmr);
}

void emit_handler(void *context, int signal)
{
    struct private_ctx *priv = (struct private_ctx *) context;
    ufsm_queue_push(priv->q, signal);
}

int main(int argc, char **argv)
{
    struct epoll_event events[MAX_EVENTS];
    struct emit_machine m;
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

    ufsm_debug_machine(&m.machine);
    ufsm_configure_emit_handler(&m.machine, emit_handler);
    ufsm_timer_init(&priv.tmr, priv.epoll_fd, q, 1500, eEnable);
    ufsm_timer_init(&priv.tmr_exit, priv.epoll_fd, q, 5000, eExitTimerExpired);

    emit_machine_initialize(&m, &priv);

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
                    emit_machine_process(&m, ufsm_queue_pop(q));
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

