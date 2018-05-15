#include <stdio.h>
#include "ufsm.h"

static struct ufsm_state * _ufsm_process (struct ufsm_state *state, 
                                                        uint32_t ev) {

    struct ufsm_table *tbl = state->tbl;
    struct ufsm_state *composite = state->composite;
    ufsm_guard *guards = NULL;
    ufsm_action *actions = NULL;
    bool guards_ok = false;
 
    if (composite) {
        printf ("State %s is a composite state\n",state->name);
        if (state->substate)
            state->substate = _ufsm_process(state->substate,ev);
    }

    while (tbl->event != -1) {
        if (tbl->event == ev) {
            guards = tbl->guards;
            
            /* Process guards first */
            guards_ok = true;
            while (*guards) {
                
                if (!(*guards)(ev)) {
                    guards_ok = false;
                    break;
                }
                guards++;
            }
            /* If any of the guards failed, process next entry in table */
            if (!guards_ok)
                goto process_next;

            actions = tbl->actions;
            
            /* Process actions */
            while (*actions) {
                (*actions) (ev);
                actions++;
            }
            
            /** 
             * Check if we should switch to a new state
             *  call appropriate entry/exit's
             */

            struct ufsm_state *next = tbl->next;

            if (next) {
                if (state->exit)
                    state->exit();

                if (next->entry)
                    next->entry();

                printf ("New state %s -> %s\n",state->name, next->name);
                next->substate = next->composite;

                return next;
           }
        }

process_next:
        tbl++;
    }

    return state;
}

struct ufsm_state * ufsm_state (struct ufsm_machine *m) {
    return m->state;
}

struct ufsm_state * ufsm_substate (struct ufsm_machine *m) {
    return m->state->substate;
}

uint32_t ufsm_init(struct ufsm_machine *m, struct ufsm_state *state) {
    m->state = state;
    return 0;
}

uint32_t ufsm_process (struct ufsm_machine *m, uint32_t ev) {
    m->state = _ufsm_process(m->state, ev);

    return 0;
}


