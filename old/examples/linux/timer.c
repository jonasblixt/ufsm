#include <string.h>
#include <sys/epoll.h>
#include "timer.h"


static int timer_configure(struct ufsm_timer *tmr, unsigned int timeout_ms)
{
    tmr->ts.it_interval.tv_sec = 0;
    tmr->ts.it_interval.tv_nsec = 0;
    tmr->ts.it_value.tv_sec = (timeout_ms / 1000L);
    tmr->ts.it_value.tv_nsec = (timeout_ms % 1000) * 1000000;

    return timerfd_settime(tmr->fd, 0, &tmr->ts, NULL);
}

int ufsm_timer_init(struct ufsm_timer *tmr,
                    int epoll_fd,
                    struct ufsm_queue *q,
                    unsigned int timeout_ms,
                    int event)
{
    memset(tmr, 0, sizeof(*tmr));
    tmr->timeout_ms = timeout_ms;
    tmr->q = q;
    tmr->fire_event = event;
    tmr->fd = timerfd_create(CLOCK_MONOTONIC, 0);
    tmr->epoll_fd = epoll_fd;
    tmr->ev.events = EPOLLIN;
    tmr->ev.data.fd = tmr->fd;

    timer_configure(tmr, 0);

    if (epoll_ctl(tmr->epoll_fd, EPOLL_CTL_ADD, tmr->ev.data.fd, &tmr->ev) == -1) {
        return -1;
    }

    return 0;
}

int ufsm_timer_free(struct ufsm_timer *tmr)
{
    int rc;

    rc = epoll_ctl(tmr->epoll_fd, EPOLL_CTL_DEL, tmr->fd, NULL);
    return rc;
}

void ufsm_timer_set(struct ufsm_timer *tmr, unsigned int timeout_ms)
{
    tmr->timeout_ms = timeout_ms;
}

int ufsm_timer_start(struct ufsm_timer *tmr)
{
    return timer_configure(tmr, tmr->timeout_ms);
}

int ufsm_timer_cancel(struct ufsm_timer *tmr)
{
    return timer_configure(tmr, 0);
}

int ufsm_timer_handle(struct ufsm_timer *tmr)
{
    ufsm_timer_cancel(tmr);
    return ufsm_queue_push(tmr->q, tmr->fire_event);
}

int ufsm_timer_get_fd(struct ufsm_timer *tmr)
{
    return tmr->fd;
}
