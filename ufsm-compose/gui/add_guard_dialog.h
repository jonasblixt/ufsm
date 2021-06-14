#include <gtk/gtk.h>
#include <ufsm/model.h>

int ufsm_add_transition_guard_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_transition *transition);

