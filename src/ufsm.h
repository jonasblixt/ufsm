/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#ifndef __UFSM_H__
#define __UFSM_H__

#include <stdint.h>
#include <stdbool.h>

/* Error codes */
#define UFSM_OK                        0
#define UFSM_ERROR                     1
#define UFSM_ERROR_NO_INIT_REGION      2
#define UFSM_ERROR_UNKNOWN_STATE_KIND  3
#define UFSM_ERROR_EVENT_NOT_PROCESSED 4
#define UFSM_ERROR_LCA_NOT_FOUND       5

extern const char *ufsm_errors[];

/* Misc defines */
#define UFSM_NO_TRIGGER -1

#ifndef NULL
    #define NULL ((void *) 0)
#endif

struct ufsm_state;
struct ufsm_machine;
struct ufsm_action;
struct ufsm_guard;
struct ufsm_transition;
struct ufsm_region;

typedef bool (*ufsm_guard_func) (void);
typedef void (*ufsm_action_func) (void);
typedef void (*ufsm_entry_exit_func) (void);

/* Debug callbacks */
typedef void (*ufsm_debug_event) (uint32_t ev);
typedef void (*ufsm_debug_transition) (struct ufsm_transition *t);
typedef void (*ufsm_debug_enter_region) (struct ufsm_region *region);
typedef void (*ufsm_debug_leave_region) (struct ufsm_region *region);
typedef void (*ufsm_debug_guard) (struct ufsm_guard *guard, bool result);
typedef void (*ufsm_debug_action) (struct ufsm_action *action);
typedef void (*ufsm_debug_enter_state) (struct ufsm_state *s);
typedef void (*ufsm_debug_exit_state) (struct ufsm_state *s);

enum ufsm_transition_kind {
    UFSM_TRANSITION_EXTERNAL,
    UFSM_TRANSITION_INTERNAL,
    UFSM_TRANSITION_LOCAL,
};

extern const char *ufsm_errors[];

enum ufsm_state_kind {
    UFSM_STATE_SIMPLE,
    UFSM_STATE_INIT,
    UFSM_STATE_FINAL,
    UFSM_STATE_SHALLOW_HISTORY,
    UFSM_STATE_DEEP_HISTORY,
    UFSM_STATE_EXIT_POINT,
    UFSM_STATE_ENTRY_POINT,
    UFSM_STATE_JOIN,
    UFSM_STATE_FORK,
};

extern const char *ufsm_state_kinds[];

struct ufsm_machine {
    const char *id;
    const char *name;
    ufsm_debug_event debug_event;
    ufsm_debug_transition debug_transition;
    ufsm_debug_enter_region debug_enter_region;
    ufsm_debug_leave_region debug_leave_region;
    ufsm_debug_guard debug_guard;
    ufsm_debug_action debug_action;
    ufsm_debug_enter_state debug_enter_state;
    ufsm_debug_exit_state debug_exit_state;

    struct ufsm_region *region;
    struct ufsm_machine *next;
};

struct ufsm_action {
    const char *id;
    const char *name;
    ufsm_action_func f;
    struct ufsm_action *next;
};

struct ufsm_guard {
    const char *id;
    const char *name;
    ufsm_guard_func f;
    struct ufsm_guard *next;
};

struct ufsm_entry_exit {
    const char *id;
    const char *name;
    ufsm_entry_exit_func f;
    struct ufsm_entry_exit *next;
};

struct ufsm_transition {
    const char *id;
    const char *name;
    const char *trigger_name;
    int32_t trigger;
    enum ufsm_transition_kind kind;
    struct ufsm_action *action;
    struct ufsm_guard *guard;
    struct ufsm_state *source;
    struct ufsm_state *dest;
    struct ufsm_transition *next;
};

struct ufsm_region {
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

struct ufsm_state {
    const char *id;
    const char *name;
    enum ufsm_state_kind kind;
    struct ufsm_entry_exit *entry;
    struct ufsm_entry_exit *exit;
    struct ufsm_region *region;
    struct ufsm_region *parent_region;
    struct ufsm_machine *submachine;
    struct ufsm_state *next;
};

uint32_t ufsm_init_machine(struct ufsm_machine *m);
uint32_t ufsm_reset_machine(struct ufsm_machine *m);
uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev);

#endif
