#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <ufsm/model.h>

#define UFSMM_STACK_DEFAULT_SZ 128

int ufsmm_stack_init(struct ufsmm_stack **stack_pp)
{
    struct ufsmm_stack *stack = NULL;
    size_t bytes_to_alloc = sizeof(void *) * UFSMM_STACK_DEFAULT_SZ;

    stack = malloc(sizeof(struct ufsmm_stack));

    if (!stack)
    {
        L_ERR("Could not allocate memory for stack");
        return -UFSMM_ERR_MEM;
    }

    memset(stack, 0, sizeof(struct ufsmm_stack));

    stack->data = malloc(bytes_to_alloc);

    if (!stack->data)
    {
        L_ERR("Could not allocate memory for stack");
        goto err_free_stack;
    }

    (*stack_pp) = stack;

    stack->no_of_elements = UFSMM_STACK_DEFAULT_SZ;
    stack->pos = 0;

    return UFSMM_OK;
err_free_stack:
    free(stack);
    return -UFSMM_ERR_MEM;
}

int ufsmm_stack_free(struct ufsmm_stack *stack)
{
    free(stack->data);
    free(stack);
    return UFSMM_OK;
}

int ufsmm_stack_push(struct ufsmm_stack *stack, void *item)
{
    if (stack->pos >= stack->no_of_elements) {
        size_t bytes_to_alloc = sizeof(void *) * stack->no_of_elements*2;
        stack->data = realloc(stack->data, bytes_to_alloc);
        stack->no_of_elements *= 2;
    }

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

int ufsmm_stack_push_sr_pair(struct ufsmm_stack *stack,
                             struct ufsmm_state *state,
                             struct ufsmm_region *region)
{
    int rc;
    void *tmp;

    rc = ufsmm_stack_push(stack, (void *) state);

    if (rc != UFSMM_OK)
        return rc;

    rc = ufsmm_stack_push(stack, (void *) region);

    if (rc != UFSMM_OK) {
        ufsmm_stack_pop(stack, &tmp);
        return rc;
    }

    return rc;
}

int ufsmm_stack_pop_sr_pair(struct ufsmm_stack *stack,
                            struct ufsmm_state **state,
                            struct ufsmm_region **region)
{
    int rc;

    rc = ufsmm_stack_pop(stack, (void **) region);

    if (rc != UFSMM_OK)
        return rc;

    rc = ufsmm_stack_pop(stack, (void **) state);

    if (rc != UFSMM_OK)
        return rc;

    return rc;
}
