#ifndef CANVAS_CONTROLLER_H_
#define CANVAS_CONTROLLER_H_

#include <gtk/gtk.h>
#include <ufsm/model.h>

int ufsmm_state_canvas_init(GtkWidget *parent, GtkWidget **canvas);
int ufsmm_state_canvas_free(GtkWidget *canvas);
int ufsmm_state_canvas_update(struct ufsmm_model *model,
                             struct ufsmm_region *region);

int ufsmm_selection_update(struct ufsmm_state *s, bool append);


#endif  // CANVAS_CONTROLLER_H_
