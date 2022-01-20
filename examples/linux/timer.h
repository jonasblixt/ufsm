#ifndef UFSM_TIMER_H
#define UFSM_TIMER_H

#include <sys/timerfd.h>
#include "queue.h"

struct ufsm_timer {
    int timeout_ms;
    struct itimerspec ts;
    bool expired;
    struct ufsm_queue *q;
    int fire_event;
    int fd;
    int epoll_fd;
    struct epoll_event ev;
};

int ufsm_timer_init(struct ufsm_timer *tmr,
                    int epoll_fd,
                    struct ufsm_queue *q,
                    unsigned int timeout_ms,
                    int event);

void ufsm_timer_set(struct ufsm_timer *tmr, unsigned int timeout_ms);
int ufsm_timer_start(struct ufsm_timer *tmr);
int ufsm_timer_cancel(struct ufsm_timer *tmr);
int ufsm_timer_get_fd(struct ufsm_timer *tmr);
int ufsm_timer_handle(struct ufsm_timer *tmr);
int ufsm_timer_free(struct ufsm_timer *tmr);

#endif
