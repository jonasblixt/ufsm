#ifndef UFSMM_NAV_H
#define UFSMM_NAV_H

#include <gtk/gtk.h>
#include "controller.h"

GtkWidget* ufsmm_nav_init(void);
int ufsmm_nav_update(struct ufsmm_model *model);

#endif
