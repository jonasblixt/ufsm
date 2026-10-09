/**
 * uFSM
 *
 * Copyright (C) 2022 Jonas Blixt <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/eventfd.h>
#include "queue.h"

int ufsm_queue_push(struct ufsm_queue *q, int ev)
{
    int err = 0;

    if (pthread_mutex_lock(&q->lock) != 0) {
        return -UFSM_ERROR_QUEUE_LOCK;
    }

    if (q->no_of_elements < q->size) {
        q->data[q->head] = ev;
        q->no_of_elements++;
        q->head++;

        if (q->head >= q->size)
            q->head = 0;

    } else {
        err = -UFSM_ERROR_QUEUE_FULL;
    }

    if (q->event_fd != -1) {
        uint64_t value = 1;
        ssize_t bytes_written = write(q->event_fd, &value, sizeof(value));

        if (bytes_written != sizeof(value)) {
            err = -UFSM_ERROR_QUEUE_EVENT;
        }
    }

    if (pthread_mutex_unlock(&q->lock) != 0) {
        err = -UFSM_ERROR_QUEUE_LOCK;
    }

    return err;
}

int ufsm_queue_pop(struct ufsm_queue *q)
{
    int result;

    if (pthread_mutex_lock(&q->lock) != 0) {
        return -UFSM_ERROR_QUEUE_LOCK;
    }

    if (q->no_of_elements) {
        result = q->data[q->tail];
        q->no_of_elements--;
        q->tail++;

        if (q->tail >= q->size)
            q->tail = 0;

    } else {
        result = -UFSM_ERROR_QUEUE_EMPTY;
    }

    if (pthread_mutex_unlock(&q->lock) != 0) {
        result = -UFSM_ERROR_QUEUE_LOCK;
    }

    return result;
}

struct ufsm_queue * ufsm_queue_init(int epoll_fd, size_t size)
{
    struct ufsm_queue *q;

    q = malloc(sizeof(struct ufsm_queue) + sizeof(int) * size);

    if (q == NULL)
        goto err_malloc_failed_out;

    memset(q, 0, sizeof(*q) + sizeof(int) * size);
    q->size = size;
    q->event_fd = eventfd(0, 0);
    q->epoll_fd = epoll_fd;

    if (pthread_mutex_init(&q->lock, NULL) != 0) {
        goto err_free_out;
    }

    /* Add the queues event fd to the epoll */
    q->ev.events = EPOLLIN;
    q->ev.data.fd = q->event_fd;

    if (epoll_ctl(q->epoll_fd, EPOLL_CTL_ADD, q->ev.data.fd, &q->ev) == -1) {
        goto err_free_mutex_out;
    }

err_malloc_failed_out:
    return q;
err_free_mutex_out:
    pthread_mutex_destroy(&q->lock);
err_free_out:
    free(q);
    return NULL;
}

int ufsm_queue_get_fd(struct ufsm_queue *q)
{
    return q->event_fd;
}

int ufsm_queue_handle(struct ufsm_queue *q, uint64_t *events)
{
    ssize_t read_bytes = read(q->event_fd, events, sizeof(uint64_t));

    if (read_bytes != sizeof(*events)) {
        return -1;
    }

    return 0;
}

void ufsm_queue_free(struct ufsm_queue *q)
{
    close(q->event_fd);
    epoll_ctl(q->epoll_fd, EPOLL_CTL_DEL, q->event_fd, NULL);
    pthread_mutex_destroy(&q->lock);
    free(q);
}
