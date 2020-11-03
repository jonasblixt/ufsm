/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <ufsm.h>

int ufsm_queue_put(struct ufsm_queue *q, int ev)
{
    int err = UFSM_OK;

    if (q->lock)
        q->lock();

    if (q->s < q->no_of_elements) {
        q->data[q->head] = ev;
        q->s++;
        q->head++;

        if (q->on_data)
            q->on_data();

        if (q->head >= q->no_of_elements)
            q->head = 0;

    } else {
        err = UFSM_ERROR_QUEUE_FULL;
    }

    if (q->unlock)
        q->unlock();

    return err;
}

int ufsm_queue_get(struct ufsm_queue *q, int *ev)
{
    int err = UFSM_OK;

    if (q->lock)
        q->lock();

    if (q->s) {
        *ev = q->data[q->tail];
        q->s--;
        q->tail++;

        if (q->tail >= q->no_of_elements)
            q->tail = 0;

    } else {
        err = UFSM_ERROR_QUEUE_EMPTY;
    }

    if (q->unlock)
        q->unlock();

    return err;
}

int ufsm_queue_init(struct ufsm_queue *q, int no_of_elements,
                                               int *data)
{
    q->head = 0;
    q->tail = 0;
    q->data = data;
    q->s = 0;
    q->no_of_elements = no_of_elements;

    return UFSM_OK;
}
