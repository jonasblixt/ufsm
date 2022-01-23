/**
 * uFSM
 *
 * Copyright (C) 2021 Jonas Blixt <jonpe960@gmail.com>
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

typedef int (*ufsm_guard_func_t) (void *context);
typedef void (*ufsm_action_func_t) (void *context);
typedef void (*ufsm_emit_signal_t) (void *context, int signal);

/* Debug callbacks */
typedef void (*ufsm_debug_event_t) (int ev);
typedef void (*ufsm_debug_transition_t) (const struct ufsm_transition *t);
typedef void (*ufsm_debug_enter_region_t) (const struct ufsm_region *region);
typedef void (*ufsm_debug_leave_region_t) (const struct ufsm_region *region);
typedef void (*ufsm_debug_guard_t) (const struct ufsm_guard *guard, int result);
typedef void (*ufsm_debug_action_t) (const struct ufsm_action *action);
typedef void (*ufsm_debug_enter_state_t) (const struct ufsm_state *s);
typedef void (*ufsm_debug_exit_state_t) (const struct ufsm_state *s);
typedef void (*ufsm_debug_entry_exit_t) (const struct ufsm_action *action);
typedef void (*ufsm_debug_reset_t) (struct ufsm_machine *m);

enum ufsm_transition_kind
{
    UFSM_TRANSITION_EXTERNAL,
    UFSM_TRANSITION_INTERNAL,
    UFSM_TRANSITION_LOCAL,
};

enum ufsm_state_kind
{
    UFSM_STATE_SIMPLE,
    UFSM_STATE_INIT,
    UFSM_STATE_FINAL,
    UFSM_STATE_SHALLOW_HISTORY,
    UFSM_STATE_DEEP_HISTORY,
    UFSM_STATE_JOIN,
    UFSM_STATE_FORK,
    UFSM_STATE_TERMINATE,
};

enum ufsm_action_kind
{
    UFSM_ACTION_KIND_NORMAL,
    UFSM_ACTION_KIND_SIGNAL,
};

enum ufsm_guard_kind
{
    UFSM_GUARD_TRUE,
    UFSM_GUARD_FALSE,
    UFSM_GUARD_EQ,
    UFSM_GUARD_GT,
    UFSM_GUARD_GTE,
    UFSM_GUARD_LT,
    UFSM_GUARD_LTE,
    UFSM_GUARD_PSTATE,
    UFSM_GUARD_NSTATE,
};

extern const char *ufsm_state_kinds[];

struct ufsm_stack
{
    int no_of_elements;
    void **data;
    int pos;
};

struct ufsm_trigger;

struct ufsm_action
{
    const char * const name;
    const enum ufsm_action_kind kind;
    const ufsm_action_func_t f;
    const struct ufsm_trigger * const signal;
    const struct ufsm_action * const next;
};

struct ufsm_guard
{
    const char * const name;
    const enum ufsm_guard_kind kind;
    const int value;
    const ufsm_guard_func_t f;
    const struct ufsm_state * const state;
    const struct ufsm_guard * const next;
};

struct ufsm_trigger
{
    const char * const name;
    const int trigger;
};

struct ufsm_transition
{
    const enum ufsm_transition_kind kind;
    const struct ufsm_trigger * const trigger;
    const struct ufsm_action * const action;
    const struct ufsm_guard * const guard;
    const struct ufsm_state * const source;
    const struct ufsm_state * const dest;
    const struct ufsm_transition * const next;
};

struct ufsm_region
{
    const unsigned int index;
    const char *name;
    const bool has_history;
    const struct ufsm_state * const state;
    const struct ufsm_state * const parent_state;
    const struct ufsm_region * const next;
};

struct ufsm_state
{
    const unsigned int index;
    const char * const name;
    const enum ufsm_state_kind kind;
    const struct ufsm_transition * const transition;
    const struct ufsm_action * const entry;
    const struct ufsm_action * const exit;
    const struct ufsm_region * const region;
    const struct ufsm_region * const parent_region;
    const struct ufsm_state * const next;
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
    const char * const name;
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
    ufsm_emit_signal_t emit_signal;
    bool terminated;
    struct ufsm_stack stack;
    struct ufsm_stack stack2;
    const struct ufsm_region * region;
    unsigned int no_of_regions;
    struct ufsm_region_data * r_data;
    unsigned int no_of_states;
    struct ufsm_state_data * s_data;
    void *context;
};

int ufsm_init_machine(struct ufsm_machine *m, void *context);
int ufsm_reset_machine(struct ufsm_machine *m);
int ufsm_process (struct ufsm_machine *m, int ev);
void ufsm_debug_machine(struct ufsm_machine *m);
void ufsm_configure_emit_handler(struct ufsm_machine *m,
                                    ufsm_emit_signal_t handler);
int ufsm_stack_init(struct ufsm_stack *stack, int no_of_elements,
                                              void **stack_data);
#endif
