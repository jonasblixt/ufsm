#ifndef CANVAS_CONTROLLER_H_
#define CANVAS_CONTROLLER_H_

#include <gtk/gtk.h>
#include <ufsm/model.h>
#include <ufsm/ufsm.h>
#include "canvas/logic/canvas.h"

enum ufsmm_selection {
    UFSMM_SELECTION_NONE,
    UFSMM_SELECTION_STATE,
    UFSMM_SELECTION_REGION,
    UFSMM_SELECTION_TRANSITION,
    UFSMM_SELECTION_MULTI,
};

struct ufsmm_canvas {
    struct canvas_machine machine;
    struct ufsmm_model *model;
    struct ufsmm_region *selected_region;
    struct ufsmm_region *current_region;
    struct ufsmm_state *selected_state;
    struct ufsmm_transition *selected_transition;
    bool redraw;
    double scale;
    double ox, oy; /* Canvas offset */
    double px, py; /* Location of mouse pointer */
    double sx, sy; /* Start coordinates */
    double tx, ty; /* Temporary coordinates */
    enum ufsmm_selection selection;
    GtkWidget *widget;
    cairo_t *cr;
};

GtkWidget* ufsmm_canvas_new(void);
void ufsmm_canvas_free(GtkWidget *widget);
int ufsmm_canvas_load_model(GtkWidget *widget, struct ufsmm_model *model);

#endif  // CANVAS_CONTROLLER_H_
