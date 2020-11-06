#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <ufsm/model/ufsmm.h>
#include <ufsm/model/stack.h>

int ufsmm_stack_init(struct ufsmm_stack **stack_pp, size_t no_of_elements)
{
    struct ufsmm_stack *stack = NULL;
    size_t bytes_to_alloc = sizeof(struct ufsmm_stack) +
                    (sizeof(void *) * no_of_elements);

    stack = malloc(bytes_to_alloc);

    if (!stack)
    {
        L_ERR("Could not allocate memory for stack");
        return -UFSMM_ERR_MEM;
    }

    memset(stack, 0, bytes_to_alloc);
    (*stack_pp) = stack;

    stack->no_of_elements = no_of_elements;
    stack->pos = 0;

    return UFSMM_OK;
}

int ufsmm_stack_free(struct ufsmm_stack *stack)
{
    free(stack);
    return UFSMM_OK;
}

int ufsmm_stack_push(struct ufsmm_stack *stack, void *item)
{
    if (stack->pos >= stack->no_of_elements)
        return -UFSMM_ERROR;

    stack->data[stack->pos++] = item;

    return UFSMM_OK;
}

int ufsmm_stack_pop(struct ufsmm_stack *stack, void **item)
{
    if(!stack->pos)
        return -UFSMM_ERROR;

    (*item) = stack->data[--stack->pos];

    return UFSMM_OK;
}
