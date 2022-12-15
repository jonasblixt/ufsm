#ifndef PROJECT_SETTINGS_H
#define PROJECT_SETTINGS_H
#include <gtk/gtk.h>
#include "../controller.h"

int ufsm_project_settings_dialog(GtkWindow *parent, struct ufsmm_model *model,
                                    struct ufsmm_region *copy_bfr);

#endif
