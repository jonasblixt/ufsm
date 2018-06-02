/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <ufsm.h>
#include <assert.h>
#include "common.h"



int main(int argc, char **argv)
{
    uint32_t err = UFSM_OK;
    uint32_t data[4];
    uint32_t i = 0;

    struct ufsm_queue q;

    assert (ufsm_queue_init(&q, 4, data) == UFSM_OK);


    err = ufsm_queue_put(&q, 1);
    assert (err == UFSM_OK);
    err = ufsm_queue_get(&q, &i);
    assert ( err == UFSM_OK && i == 1);

    err = ufsm_queue_get(&q, &i);
    assert ( err == UFSM_ERROR_QUEUE_EMPTY);

    err = ufsm_queue_put(&q, 1);
    err = ufsm_queue_put(&q, 2);
    err = ufsm_queue_put(&q, 3);
    err = ufsm_queue_put(&q, 4);
    
    assert (err == UFSM_OK);
    err = ufsm_queue_put(&q, 5);
    assert (err == UFSM_ERROR_QUEUE_FULL);

    err = ufsm_queue_get(&q, &i);
    assert ( err == UFSM_OK && i == 1);
    err = ufsm_queue_get(&q, &i);
    assert ( err == UFSM_OK && i == 2);
    err = ufsm_queue_get(&q, &i);
    assert ( err == UFSM_OK && i == 3);
    err = ufsm_queue_get(&q, &i);
    assert ( err == UFSM_OK && i == 4);


    return 0;
}
