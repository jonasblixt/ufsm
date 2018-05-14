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

#ifndef UFSM_MAX_ORTHOGONAL_STATES
    #define UFSM_MAX_ORTHOGONAL_STATES 4
#endif

#define UFSM_SENTINEL  {-1, {NULL}, {NULL}, NULL },
 

struct ufsm_state;
struct ufsm_machine;
struct ufsm_event;


typedef bool (*ufsm_guard) (const struct ufsm_state *state,
                            const struct ufsm_machine *machine,
                            const struct ufsm_event *event);

typedef bool (*ufsm_action) (const struct ufsm_state *state,
                            const struct ufsm_machine *machine,
                            const struct ufsm_event *event);


typedef bool (*ufsm_entry_exit) (const struct ufsm_state *state,
                            const struct ufsm_machine *machine);

struct ufsm_machine {
    struct ufsm_state *state_matrix[UFSM_MAX_ORTHOGONAL_STATES];
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
    struct ufsm_state *composite;
    struct ufsm_table tbl[];
};

struct ufsm_event {
    uint32_t id;
    uint32_t data;
};

uint32_t ufsm_init();
uint32_t ufsm_process (struct ufsm_machine *m, struct ufsm_event *ev);
 
#endif
