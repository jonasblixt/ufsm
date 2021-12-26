#ifndef CANVAS_CONTROLLER_H_
#define CANVAS_CONTROLLER_H_

#include <gtk/gtk.h>
#include <ufsm/model.h>
#include <ufsm/ufsm.h>
#include "logic/canvas.h"
#include "undo.h"
#include "menu.h"
#include "colors.h"
#include "common.h"

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
    bool draw_menu;
    struct menu *menu;
    struct ufsmm_undo_context *undo;
    void *command_data;
    bool redraw;
    double dx, dy;
    double px, py; /* Location of mouse pointer */
    double sx, sy; /* Start coordinates */
    bool snap_x, snap_y;
    bool snap_global;
    double snap_x_val, snap_y_val;
    double snap_x_threshold, snap_y_threshold;
    int window_width;
    int window_height;
    GtkWidget *widget;
    GtkWidget *root_window;
    cairo_t *cr;
};

GtkWidget* ufsmm_canvas_new(GtkWidget *parent);
int ufsmm_canvas_load_model(GtkWidget *widget, struct ufsmm_model *model);
void ufsmm_canvas_reset_delta(struct ufsmm_canvas *canvas);

#endif  // CANVAS_CONTROLLER_H_
