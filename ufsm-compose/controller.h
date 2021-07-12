#ifndef CANVAS_CONTROLLER_H_
#define CANVAS_CONTROLLER_H_

#include <gtk/gtk.h>
#include <ufsm/model.h>
#include <ufsm/ufsm.h>
#include "logic/canvas.h"
#include "undo.h"

enum ufsmm_selection {
    UFSMM_SELECTION_NONE,
    UFSMM_SELECTION_STATE,
    UFSMM_SELECTION_REGION,
    UFSMM_SELECTION_TRANSITION,
    UFSMM_SELECTION_ENTRY,
    UFSMM_SELECTION_EXIT,
    UFSMM_SELECTION_ACTION,
    UFSMM_SELECTION_GUARD,
    UFSMM_SELECTION_MULTI,
};

enum ufsmm_resize_selector {
    UFSMM_NO_SELECTION,
    UFSMM_TOP_LEFT,
    UFSMM_TOP_MIDDLE,
    UFSMM_TOP_RIGHT,
    UFSMM_RIGHT_MIDDLE,
    UFSMM_BOT_RIGHT,
    UFSMM_BOT_MIDDLE,
    UFSMM_BOT_LEFT,
    UFSMM_LEFT_MIDDLE
};

enum ufsmm_color_theme {
    UFSMM_COLOR_THEME_DARK,
    UFSMM_COLOR_THEME_LIGHT,
};

struct ufsmm_canvas {
    struct canvas_machine machine;
    struct ufsmm_model *model;
    struct ufsmm_region *current_region;
    enum ufsmm_color_theme theme;
    /* Active selection */
    enum ufsmm_selection selection;
    struct ufsmm_region *selected_region;
    struct ufsmm_state *selected_state;
    enum ufsmm_resize_selector selected_corner;
    enum ufsmm_transition_vertice_kind selected_transition_vertice;
    struct ufsmm_vertice *selected_transition_vertice_data;
    struct ufsmm_action_ref *selected_aref;
    struct ufsmm_guard_ref *selected_guard;
    struct ufsmm_transition *selected_transition;
    unsigned int selection_count;
    /* Preview for 'add' operations */
    struct ufsmm_state *preview_state;
    struct ufsmm_transition *preview_transition;
    /* Copy/Paste stuff */
    struct ufsmm_region *copy_bfr;
    /* Common stuff */
    struct ufsmm_undo_context *undo;
    void *command_data;
    bool redraw;
    double dx, dy;
    double px, py; /* Location of mouse pointer */
    double sx, sy; /* Start coordinates */
    GtkWidget *widget;
    GtkWidget *root_window;
    cairo_t *cr;
};

GtkWidget* ufsmm_canvas_new(GtkWidget *parent);
int ufsmm_canvas_load_model(GtkWidget *widget, struct ufsmm_model *model);
void ufsmm_canvas_reset_delta(struct ufsmm_canvas *canvas);

#endif  // CANVAS_CONTROLLER_H_
