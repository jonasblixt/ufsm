/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#ifndef UFSM_H
#define UFSM_H

#include <stdint.h>
#include <stdbool.h>

/* Error codes */

enum ufsm_status_codes
{
    UFSM_OK,
    UFSM_ERROR,
    UFSM_ERROR_NO_INIT_REGION,
    UFSM_ERROR_UNKNOWN_STATE_KIND,
    UFSM_ERROR_EVENT_NOT_PROCESSED,
    UFSM_ERROR_LCA_NOT_FOUND,
    UFSM_ERROR_STACK_OVERFLOW,
    UFSM_ERROR_STACK_UNDERFLOW,
    UFSM_ERROR_QUEUE_EMPTY,
    UFSM_ERROR_QUEUE_FULL,
    UFSM_ERROR_MACHINE_TERMINATED,
};

typedef enum ufsm_status_codes ufsm_status_t;

extern const char *ufsm_errors[];

/* Misc defines */
#define UFSM_NO_TRIGGER -1
#define UFSM_COMPLETION_EVENT -1

#ifndef UFSM_STACK_SIZE
    #define UFSM_STACK_SIZE 128
#endif

#ifndef UFSM_COMPLETION_STACK_SIZE
    #define UFSM_COMPLETION_STACK_SIZE 16
#endif

#ifndef UFSM_QUEUE_SIZE
    #define UFSM_QUEUE_SIZE 16
#endif

#ifndef UFSM_DEFER_QUEUE_SIZE
    #define UFSM_DEFER_QUEUE_SIZE 16
#endif

#ifndef NULL
    #define NULL ((void *) 0)
#endif

struct ufsm_state;
struct ufsm_machine;
struct ufsm_action;
struct ufsm_guard;
struct ufsm_transition;
struct ufsm_region;
struct ufsm_entry_exit;

typedef bool (*ufsm_guard_func_t) (void);
typedef void (*ufsm_action_func_t) (void);
typedef void (*ufsm_entry_exit_func_t) (void);
typedef void (*ufsm_queue_cb_t) (void);
typedef uint32_t (*ufsm_doact_cb_t) (struct ufsm_machine *m, struct ufsm_state *s);
typedef void (*ufsm_doact_func_t) (struct ufsm_machine *m,
                                   struct ufsm_state *s,
                                   ufsm_doact_cb_t cb);

/* Debug callbacks */
typedef void (*ufsm_debug_event_t) (uint32_t ev);
typedef void (*ufsm_debug_transition_t) (struct ufsm_transition *t);
typedef void (*ufsm_debug_enter_region_t) (struct ufsm_region *region);
typedef void (*ufsm_debug_leave_region_t) (struct ufsm_region *region);
typedef void (*ufsm_debug_guard_t) (struct ufsm_guard *guard, bool result);
typedef void (*ufsm_debug_action_t) (struct ufsm_action *action);
typedef void (*ufsm_debug_enter_state_t) (struct ufsm_state *s);
typedef void (*ufsm_debug_exit_state_t) (struct ufsm_state *s);
typedef void (*ufsm_debug_entry_exit_t) (struct ufsm_entry_exit *f);
typedef void (*ufsm_debug_reset_t) (struct ufsm_machine *m);

enum ufsm_transition_kind
{
    UFSM_TRANSITION_EXTERNAL,
    UFSM_TRANSITION_INTERNAL,
    UFSM_TRANSITION_LOCAL,
};

extern const char *ufsm_errors[];

enum ufsm_state_kind
{
    UFSM_STATE_SIMPLE,
    UFSM_STATE_INIT,
    UFSM_STATE_FINAL,
    UFSM_STATE_SHALLOW_HISTORY,
    UFSM_STATE_DEEP_HISTORY,
    UFSM_STATE_EXIT_POINT,
    UFSM_STATE_ENTRY_POINT,
    UFSM_STATE_JOIN,
    UFSM_STATE_FORK,
    UFSM_STATE_CHOICE,
    UFSM_STATE_JUNCTION,
    UFSM_STATE_TERMINATE,
};

extern const char *ufsm_state_kinds[];

struct ufsm_stack
{
    uint32_t no_of_elements;
    void **data;
    uint32_t pos;
};

struct ufsm_queue
{
    uint32_t no_of_elements;
    uint32_t s;
    uint32_t head;
    uint32_t tail;
    uint32_t *data;
    ufsm_queue_cb_t on_data;
    ufsm_queue_cb_t lock;
    ufsm_queue_cb_t unlock;
};

struct ufsm_machine
{
    const char *id;
    const char *name;
    ufsm_debug_event_t debug_event;
    ufsm_debug_transition_t debug_transition;
    ufsm_debug_enter_region_t debug_enter_region;
    ufsm_debug_leave_region_t debug_leave_region;
    ufsm_debug_guard_t debug_guard;
    ufsm_debug_action_t debug_action;
    ufsm_debug_enter_state_t debug_enter_state;
    ufsm_debug_exit_state_t debug_exit_state;
    ufsm_debug_reset_t debug_reset;
    ufsm_debug_entry_exit_t debug_entry_exit;
    bool terminated;
    void *stack_data[UFSM_STACK_SIZE];
    void *stack_data2[UFSM_STACK_SIZE];
    void *completion_stack_data[UFSM_COMPLETION_STACK_SIZE];
    uint32_t queue_data[UFSM_QUEUE_SIZE];
    uint32_t defer_queue_data[UFSM_DEFER_QUEUE_SIZE];
    struct ufsm_queue queue;
    struct ufsm_queue defer_queue;
    struct ufsm_state *parent_state;
    struct ufsm_stack stack;
    struct ufsm_stack stack2;
    struct ufsm_stack completion_stack;
    struct ufsm_region *region;
    struct ufsm_machine *next;
};

struct ufsm_action
{
    const char *id;
    const char *name;
    ufsm_action_func_t f;
    struct ufsm_action *next;
};

struct ufsm_guard
{
    const char *id;
    const char *name;
    ufsm_guard_func_t f;
    struct ufsm_guard *next;
};

struct ufsm_entry_exit
{
    const char *id;
    const char *name;
    ufsm_entry_exit_func_t f;
    struct ufsm_entry_exit *next;
};

struct ufsm_doact
{
    const char *id;
    const char *name;
    ufsm_doact_func_t f_start;
    ufsm_entry_exit_func_t f_stop;
    struct ufsm_doact *next;
};

struct ufsm_trigger
{
    const char *name;
    uint32_t trigger;
    struct ufsm_trigger *next;
};

struct ufsm_transition
{
    const char *id;
    const char *name;
    bool defer;
    enum ufsm_transition_kind kind;
    struct ufsm_trigger *trigger;
    struct ufsm_action *action;
    struct ufsm_guard *guard;
    struct ufsm_state *source;
    struct ufsm_state *dest;
    struct ufsm_transition *next;
};

struct ufsm_region
{
    const char *id;
    const char *name;
    bool has_history;
    struct ufsm_state *current;
    struct ufsm_state *history;
    struct ufsm_state *state;
    struct ufsm_transition *transition;
    struct ufsm_state *parent_state;
    struct ufsm_region *next;
};

struct ufsm_state
{
    const char *id;
    const char *name;
    bool cant_exit;
    enum ufsm_state_kind kind;
    struct ufsm_entry_exit *entry;
    struct ufsm_doact *doact;
    struct ufsm_entry_exit *exit;
    struct ufsm_region *region;
    struct ufsm_region *parent_region;
    struct ufsm_machine *submachine;
    struct ufsm_state *next;
};

ufsm_status_t ufsm_init_machine(struct ufsm_machine *m);
ufsm_status_t ufsm_reset_machine(struct ufsm_machine *m);
ufsm_status_t ufsm_process (struct ufsm_machine *m, int32_t ev);
ufsm_status_t ufsm_stack_init(struct ufsm_stack *stack,
                              uint32_t no_of_elements,
                              void **stack_data);
ufsm_status_t ufsm_stack_push(struct ufsm_stack *stack, void *item);
ufsm_status_t ufsm_stack_pop(struct ufsm_stack *stack, void **item);
ufsm_status_t ufsm_queue_init(struct ufsm_queue *q, uint32_t no_of_elements,
                              uint32_t *data);
ufsm_status_t ufsm_queue_put(struct ufsm_queue *q, uint32_t ev);
ufsm_status_t ufsm_queue_get(struct ufsm_queue *q, uint32_t *ev);
struct ufsm_queue * ufsm_get_queue(struct ufsm_machine *m);
void ufsm_debug_machine(struct ufsm_machine *m);

#endif
