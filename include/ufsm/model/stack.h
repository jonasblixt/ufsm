#ifndef INCLUDE_UFSMM_STACK_H_
#define INCLUDE_UFSMM_STACK_H_

#include <stdint.h>
#include <stddef.h>

struct ufsmm_stack
{
    size_t no_of_elements;
    size_t pos;
    void *data[];
};


int ufsmm_stack_init(struct ufsmm_stack **stack, size_t no_of_elements);
int ufsmm_stack_free(struct ufsmm_stack *stack);
int ufsmm_stack_push(struct ufsmm_stack *stack, void *item);
int ufsmm_stack_pop(struct ufsmm_stack *stack, void **item);

#endif  // INCLUDE_UFSMM_STACK_H_
