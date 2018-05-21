#ifndef __UFSM_H__
#define __UFSM_H__

#include <stdint.h>
#include <stdbool.h>

#define UFSM_OK 0
#define UFSM_ERROR 1

#define UFSM_NO_TRIGGER -1

struct ufsm_state;
struct ufsm_machine;
struct ufsm_event;
struct ufsm_action;
struct ufsm_guard;
struct ufsm_transition;

typedef bool (*ufsm_guard_func) (void);
typedef void (*ufsm_action_func) (void);
typedef void (*ufsm_entry_exit_func) (void);

enum ufsm_transition_kind {
    UFSM_TRANSITION_EXTERNAL,
    UFSM_TRANSITION_INTERNAL,
};

enum ufsm_state_kind {
    UFSM_STATE_SIMPLE,
    UFSM_STATE_INIT,
    UFSM_STATE_FINAL,
    UFSM_STATE_SHALLOW_HISTORY,
    UFSM_STATE_DEEP_HISTORY
};

struct ufsm_machine {
    const char *id;
    const char *name;
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
    struct ufsm_state *current;
    struct ufsm_state *history;
    struct ufsm_state *state;
    struct ufsm_transition *transition;
    struct ufsm_region *next;
};

struct ufsm_state {
    const char *id;
    const char *name;
    enum ufsm_state_kind kind;
    struct ufsm_entry_exit *entry;
    struct ufsm_entry_exit *exit;
    struct ufsm_region *region;
    struct ufsm_machine *submachine;
    struct ufsm_state *next;
};

uint32_t ufsm_init(struct ufsm_machine *m);
uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev);

#endif
