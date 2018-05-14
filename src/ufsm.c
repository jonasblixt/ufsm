#include <stdio.h>
#include "ufsm.h"

uint32_t ufsm_init(struct ufsm_machine *m, struct ufsm_state *state) {
    m->state_matrix[0] = state;
    return 0;
}

uint32_t ufsm_process (struct ufsm_machine *m, struct ufsm_event *ev) {
    if (m == NULL || m->state_matrix[0] == NULL)
        return 1;

    bool unhandeled_event = false;
    bool event_processed = false;
    struct ufsm_state *state = m->state_matrix[0];
    struct ufsm_table *tbl = NULL; 
    ufsm_guard *guards;
    ufsm_action *actions;
    bool guards_ok;
    uint32_t state_idx = 0;

process_orthogonal_region:
    guards = NULL;
    actions = NULL;
    guards_ok = false;
    tbl = state->tbl;
    
    if (state->composite != NULL)
        event_processed = true;

    while (tbl->event != -1) {
        if (tbl->event == ev->id) {
            event_processed = true;
            guards = tbl->guards;
            
            /* Process guards first */
            guards_ok = true;
            while (*guards != NULL) {
                
                if (!(*guards)(state, m, ev)) {
                    guards_ok = false;
                    break;
                }
                guards++;
            }
            /* If any of the guards failed, process next entry in table */
            if (!guards_ok)
                goto process_next;

            actions = tbl->actions;
            
            printf ("Calling actions in state %s\n", state->name);
            /* Process actions */
            while (*actions != NULL) {
                (*actions) (state, m, ev);
                actions++;
            }
            
            /* Check if we should switch to a new state
             *  call appropriate entry/exit's
             **/

            if (tbl->next != NULL) {
                if (state->exit != NULL)
                    state->exit(state, m);

                m->state_matrix[state_idx] = tbl->next;

                if (state->entry != NULL)
                    state->entry(state, m);
                
                /* If we are entering into a state with orthogonal regions
                 * we need to update the 'state_matrix' and
                 * call entry functions
                 **/
                struct ufsm_state *composite = 
                        m->state_matrix[state_idx]->composite;
                int i = 1;
                if (m->state_matrix[state_idx]->composite != NULL &&
                    state_idx == 0) {
                    do {
                        m->state_matrix[i++] = composite;

                        if (composite->entry != NULL)
                            composite->entry(state, m);
                        composite = composite->composite;
                    } while (composite != NULL);
                    
                }
            }
        }

process_next:
        tbl++;
    }
        
    if (!event_processed)
        unhandeled_event = true;
    
    /* Check for composite states */
    if (state->composite != NULL) {
        state = state->composite;
        state_idx++;
        goto process_orthogonal_region;
    }
    
    return unhandeled_event;
}

