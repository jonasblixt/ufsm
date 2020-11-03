/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <ufsm.h>

int ufsm_stack_init(struct ufsm_stack *stack,
                        int no_of_elements,
                        void **stack_data)
{
    stack->no_of_elements = no_of_elements;
    stack->data = stack_data;
    stack->pos = 0;

    return UFSM_OK;
}

int ufsm_stack_push(struct ufsm_stack *stack, void *item)
{
    if (stack->pos >= stack->no_of_elements)
        return UFSM_ERROR_STACK_OVERFLOW;

    stack->data[stack->pos++] = item;

    return UFSM_OK;
}

int ufsm_stack_pop(struct ufsm_stack *stack, void **item)
{
    if(!stack->pos)
        return UFSM_ERROR_STACK_UNDERFLOW;

    stack->pos--;

    *item = stack->data[stack->pos];

    return UFSM_OK;
}
