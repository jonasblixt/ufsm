#ifndef __UFSM_H__
#define __UFSM_H__

#include <stdint.h>
#include <stdbool.h>

#ifndef UFSM_MAX_GUARDS
    #define UFSM_MAX_GUARDS 4
#endif

#ifndef UFSM_MAX_ACTIONS
    #define UFSM_MAX_ACTIONS 4
#endif

#define UFSM_SENTINEL  {-1, {NULL}, {NULL}, NULL },
 

struct ufsm_state;
struct ufsm_machine;
struct ufsm_event;


typedef bool (*ufsm_guard) (uint32_t ev);

typedef void (*ufsm_action) (uint32_t ev);


typedef void (*ufsm_entry_exit) (void);

struct ufsm_machine {
    struct ufsm_state *state;
};

struct ufsm_table {
    const int32_t event;
    ufsm_guard guards[UFSM_MAX_GUARDS];
    ufsm_action actions[UFSM_MAX_ACTIONS];
    struct ufsm_state *next;
};

struct ufsm_state {
    const char *name;
    const ufsm_entry_exit entry;
    const ufsm_entry_exit exit;
    struct ufsm_state *superstate;
    struct ufsm_state *substate;
    struct ufsm_state *composite;
    struct ufsm_table tbl[];
};

uint32_t ufsm_init(struct ufsm_machine *m, struct ufsm_state *state);
uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev);
struct ufsm_state * ufsm_state (struct ufsm_machine *m);
struct ufsm_state * ufsm_substate (struct ufsm_machine *m);

#endif
