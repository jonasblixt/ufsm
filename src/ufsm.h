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
    UFSM_ERROR_MACHINE_TERMINATED,
};

extern const char *ufsm_errors[];

/* Misc defines */
#define UFSM_NO_TRIGGER -1
#define UFSM_COMPLETION_EVENT -1

#ifndef UFSM_STACK_SIZE
    #define UFSM_STACK_SIZE 128
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

typedef bool (*ufsm_guard_func_t) (void *context);
typedef void (*ufsm_action_func_t) (void *context);
typedef void (*ufsm_entry_exit_func_t) (void *context);

/* Debug callbacks */
typedef void (*ufsm_debug_event_t) (int ev);
typedef void (*ufsm_debug_transition_t) (const struct ufsm_transition *t);
typedef void (*ufsm_debug_enter_region_t) (const struct ufsm_region *region);
typedef void (*ufsm_debug_leave_region_t) (const struct ufsm_region *region);
typedef void (*ufsm_debug_guard_t) (const struct ufsm_guard *guard, bool result);
typedef void (*ufsm_debug_action_t) (const struct ufsm_action *action);
typedef void (*ufsm_debug_enter_state_t) (const struct ufsm_state *s);
typedef void (*ufsm_debug_exit_state_t) (const struct ufsm_state *s);
typedef void (*ufsm_debug_entry_exit_t) (const struct ufsm_entry_exit *f);
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
    int no_of_elements;
    void **data;
    int pos;
};

struct ufsm_action
{
    const char *name;
    const ufsm_action_func_t f;
    const struct ufsm_action *next;
};

struct ufsm_guard
{
    const char *name;
    const ufsm_guard_func_t f;
    const struct ufsm_guard *next;
};

struct ufsm_entry_exit
{
    const char *name;
    const ufsm_entry_exit_func_t f;
    const struct ufsm_entry_exit *next;
};

struct ufsm_trigger
{
    const char *name;
    const int trigger;
};

struct ufsm_transition
{
    const enum ufsm_transition_kind kind;
    const struct ufsm_trigger *trigger;
    const struct ufsm_action *action;
    const struct ufsm_guard *guard;
    const struct ufsm_state *source;
    const struct ufsm_state *dest;
    const struct ufsm_transition *next;
};

struct ufsm_region
{
    const unsigned int index;
    const char *name;
    const bool has_history;
    const struct ufsm_state *state;
    const struct ufsm_state *parent_state;
    const struct ufsm_region *next;
};

struct ufsm_state
{
    const unsigned int index;
    const char *name;
    const enum ufsm_state_kind kind;
    const struct ufsm_transition *transition;
    const struct ufsm_entry_exit *entry;
    const struct ufsm_entry_exit *exit;
    const struct ufsm_region *region;
    const struct ufsm_region *parent_region;
    const struct ufsm_state *next;
};

struct ufsm_region_data
{
    const struct ufsm_state *current;
    const struct ufsm_state *history;
};

struct ufsm_state_data
{
    const struct ufsm_state *state;
    bool cant_exit;
    bool completed;
};

struct ufsm_machine
{
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
    struct ufsm_stack stack;
    struct ufsm_stack stack2;
    void *stack_data2;
    void *stack_data;
    const struct ufsm_region *region;
    unsigned int no_of_regions;
    struct ufsm_region_data *r_data;
    unsigned int no_of_states;
    struct ufsm_state_data *s_data;
    void *context;
};

int ufsm_init_machine(struct ufsm_machine *m, void *context);
int ufsm_reset_machine(struct ufsm_machine *m);
int ufsm_process (struct ufsm_machine *m, int ev);
int ufsm_stack_init(struct ufsm_stack *stack, int no_of_elements, void **stack_data);
int ufsm_stack_push(struct ufsm_stack *stack, const void *item);
int ufsm_stack_pop(struct ufsm_stack *stack, void **item);
void ufsm_debug_machine(struct ufsm_machine *m);

#endif
