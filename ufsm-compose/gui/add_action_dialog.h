#include <gtk/gtk.h>
#include <ufsm/model.h>

int ufsm_add_entry_action_dialog(GtkWindow *parent, struct ufsmm_model *model,
                                struct ufsmm_state *state);

int ufsm_add_exit_action_dialog(GtkWindow *parent, struct ufsmm_model *model,
                                struct ufsmm_state *state);

int ufsm_add_transition_action_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_transition *transition);
