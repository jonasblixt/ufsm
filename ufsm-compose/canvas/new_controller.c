#include <stdio.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include <gtk/gtk.h>
#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

/* Entry action function prototypes */
void canvas_update_selection(void *context)
{
}

void canvas_show_tool_help(void *context)
{
}

void canvas_check_sresize_boxes(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    double x, y, w, h;
    double px = priv->px;
    double py = priv->py;

    if (s->kind != UFSMM_STATE_NORMAL)
        return;

    ufsmm_get_state_absolute_coords(priv->selected_state, &x, &y, &w, &h);

    x += r->ox;
    y += r->oy;

    /* Check re-size boxes */
    if (point_in_box(px, py, x, y, 10, 10)) {
        L_DEBUG("Top left corner!");
        priv->selected_state_corner = UFSMM_TOP_LEFT;
    } else if (point_in_box(px, py, x + w, y, 10, 10)) {
        L_DEBUG("Top right corner!");
        priv->selected_state_corner = UFSMM_TOP_RIGHT;
    } else if (point_in_box(px, py, x + w/2, y, 10, 10)) {
        L_DEBUG("Top middle");
        priv->selected_state_corner = UFSMM_TOP_MIDDLE;
    } else if (point_in_box(px, py, x, y + h/2, 10, 10)) {
        L_DEBUG("Left middle");
        priv->selected_state_corner = UFSMM_LEFT_MIDDLE;
    } else if (point_in_box(px, py, x, y + h, 10, 10)) {
        L_DEBUG("Bottom left corner");
        priv->selected_state_corner = UFSMM_BOT_LEFT;
    } else if (point_in_box(px, py, x + w/2, y + h, 10, 10)) {
        L_DEBUG("Bottom middle");
        priv->selected_state_corner = UFSMM_BOT_MIDDLE;
    } else if (point_in_box(px, py, x + w, y + h, 10, 10)) {
        L_DEBUG("Bottom right corner");
        priv->selected_state_corner = UFSMM_BOT_RIGHT;
    } else if (point_in_box(px, py, x + w, y + h/2, 10, 10)) {
        L_DEBUG("Right middle");
        priv->selected_state_corner = UFSMM_RIGHT_MIDDLE;
    } else {
        priv->selected_state_corner = UFSMM_NO_SELECTION;
    }
}

void canvas_check_rresize_boxes(void *context)
{
}

void canvas_check_action_func(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;

    if (priv->selected_aref != NULL) {
        priv->selected_aref->focus = false;
        priv->selected_aref = NULL;
    }

    if (priv->selection == UFSMM_SELECTION_STATE) {
        /* Check action functions */
        for (struct ufsmm_action_ref *ar = s->entries; ar; ar = ar->next) {
            if (point_in_box2(priv->px, priv->py, ar->x + r->ox, ar->y + r->oy, ar->w, ar->h)) {
                L_DEBUG("%s selected", ar->act->name);
                priv->selected_aref = ar;
                ar->focus = true;
            } else {
                ar->focus = false;
            }
        }

        for (struct ufsmm_action_ref *ar = s->exits; ar; ar = ar->next) {
            if (point_in_box2(priv->px, priv->py, ar->x + r->ox, ar->y + r->oy, ar->w, ar->h)) {
                L_DEBUG("%s selected", ar->act->name);
                priv->selected_aref = ar;
                ar->focus = true;
            } else {
                ar->focus = false;
            }
        }
    }
}

void canvas_reset_focus(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
}

void canvas_focus_state(void *context)
{
}

void canvas_focus_region(void *context)
{
}

void canvas_begin_mselect(void *context)
{
}

void canvas_focus_transition(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    L_DEBUG("Transition %s --> %s selected",
                t->source.state->name, t->dest.state->name);
    t->focus = true;
    priv->redraw = true;
}

void canvas_check_transition_vertice(void *context)
{
}

void canvas_check_guard(void *context)
{
}

void canvas_check_action(void *context)
{
}

void canvas_focus_guard(void *context)
{
}

void canvas_focus_action(void *context)
{
}

void canvas_focus_entry(void *context)
{
}

void canvas_focus_exit(void *context)
{
}

void canvas_check_text_block(void *context)
{
}

/* Exit action function prototypes */
void canvas_hide_tool_help(void *context)
{
}

void canvas_end_mselect(void *context)
{
}

void canvas_hide_state_hint(void *context)
{
}

void canvas_show_state_hint(void *context)
{
}

void canvas_hide_transition_hint(void *context)
{
}

void canvas_cleanup_transition(void *context)
{
}

bool canvas_guard_selected(void *context)
{
    return false;
}

bool canvas_action_selected(void *context)
{
    return false;
}

bool canvas_state_exit_selected(void *context)
{
    return false;
}

bool canvas_textblock_resize_selected(void *context)
{
    return false;
}

bool canvas_only_state_selected(void *context)
{
    return false;
}


/* Action function prototypes */
void canvas_select_root_region(void *context)
{
}



void canvas_zoom_in(void *context)
{
}

void canvas_zoom_out(void *context)
{
}

void canvas_move_state_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_state *s = priv->selected_state;

    printf("State MOVE BEGIN\n");

    priv->sx = priv->px - s->x;
    priv->sy = priv->py - s->y;
}

void canvas_move_state(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *new_pr;
    struct ufsmm_state *s = priv->selected_state;
    struct ufsmm_region *r = priv->current_region;
    double x, y, w, h;
    double tx_tmp, ty_tmp;
    double ox, oy;
    int rc;
    printf("move %s --> %f %f\n", s->name, priv->px, priv->py);

    s->x = ufsmm_canvas_nearest_grid_point(priv->px - priv->sx);
    s->y = ufsmm_canvas_nearest_grid_point(priv->py - priv->sy);
/*
    rc = ufsmm_region_get_at_xy(priv->current_region, tx_tmp, ty_tmp, &new_pr, NULL);

    if (rc == UFSMM_OK && (selected_state->parent_region != new_pr)) {
        if (ufsmm_state_move_to_region(model, selected_state, new_pr) == UFSMM_OK) {
            L_DEBUG("Re-parent '%s' to region: %s", selected_state->name,
                                                    new_pr->name);
            ufsmm_canvas_get_offset(&ox, &oy);

            ox = ox / ufsmm_canvas_get_scale();
            oy = oy / ufsmm_canvas_get_scale();
            ufsmm_get_region_absolute_coords(new_pr, &x, &y, &w, &h);
            selected_state->x = tx_tmp - (x + ox);
            selected_state->y = ty_tmp - (y + oy);
        }
    }
*/
    //ufsmm_canvas_state_translate(priv->selected_state, dx, dy);
    priv->redraw = true;
}


void canvas_resize_region(void *context)
{
}

void canvas_reorder_entry_func(void *context)
{
}

void canvas_update_mselect(void *context)
{
}

void canvas_move_text_block(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_transition *t = priv->selected_transition;

    t->text_block_coords.x = ufsmm_canvas_nearest_grid_point(priv->tx + priv->dx);
    t->text_block_coords.y = ufsmm_canvas_nearest_grid_point(priv->ty + priv->dy);

    priv->redraw = true;
}

void canvas_move_tvertice(void *context)
{
}

void canvas_move_svertice(void *context)
{
}

void canvas_move_dvertice(void *context)
{
}

void canvas_reorder_exit_func(void *context)
{
}

void canvas_reorder_guard_func(void *context)
{
}

void canvas_reorder_action_func(void *context)
{
}

void canvas_resize_textblock(void *context)
{
}

void canvas_add_region(void *context)
{
}

void canvas_add_entry(void *context)
{
}

void canvas_add_exit(void *context)
{
}

void canvas_edit_state_name(void *context)
{
}

void canvas_edit_state_entry(void *context)
{
}

void canvas_edit_state_exit(void *context)
{
}

void canvas_translate_state(void *context)
{
}

void canvas_delete_entry(void *context)
{
}

void canvas_delete_exit(void *context)
{
}

void canvas_delete_state(void *context)
{
}

void canvas_new_state_set_scoords(void *context)
{
}

void canvas_create_new_state(void *context)
{
}

void canvas_update_state_hint(void *context)
{
}

void canvas_create_transition_start(void *context)
{
}

void canvas_update_transition_hint(void *context)
{
}

void canvas_create_transition(void *context)
{
}

void canvas_transition_vdel_last(void *context)
{
}

void canvas_add_transition_vertice(void *context)
{
}

void canvas_create_init_state(void *context)
{
}

void canvas_create_final_state(void *context)
{
}

void canvas_save_model(void *context)
{
}


gboolean keypress_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->keyval == GDK_KEY_A) {
        if (priv->current_region->parent_state) {
            L_DEBUG("Ascending to region: %s",
                    priv->current_region->parent_state->parent_region->name);
            priv->current_region->draw_as_root = false;
            do {
                if (!priv->current_region->parent_state)
                    break;
                priv->current_region = priv->current_region->parent_state->parent_region;
            } while (!priv->current_region->off_page);
            priv->current_region->draw_as_root = true;
        }
        priv->redraw = true;
    } else if (event->keyval == GDK_KEY_Shift_L) {
        canvas_machine_process(&priv->machine, eKey_shift_down);
    } else if (event->keyval == GDK_KEY_Control_L) {
        canvas_machine_process(&priv->machine, eEnableScale);
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

gboolean keyrelease_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->keyval == GDK_KEY_Shift_L) {
        canvas_machine_process(&priv->machine, eKey_shift_up);
    } else if (event->keyval == GDK_KEY_Control_L) {
        canvas_machine_process(&priv->machine, eDisableScale);
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

static gboolean buttonpress_cb(GtkWidget *widget, GdkEventButton *event)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    priv->sx = ufsmm_canvas_nearest_grid_point(event->x / priv->current_region->scale);
    priv->sy = ufsmm_canvas_nearest_grid_point(event->y / priv->current_region->scale);

    if (event->type == GDK_BUTTON_PRESS && event->button == 3) {
        ufsm_process(&priv->machine.machine, eEnablePan);
    } else if (event->type == GDK_BUTTON_PRESS && event->button == 1) {
        ufsm_process(&priv->machine.machine, eLMBDown);
    }

    if (event->type == GDK_DOUBLE_BUTTON_PRESS) {
        if (priv->selection == UFSMM_SELECTION_REGION) {
            L_DEBUG("Switching view to region '%s'", priv->selected_region->name);
            priv->current_region->draw_as_root = false;
            priv->selected_region->draw_as_root = true;
            priv->current_region = priv->selected_region;
            if (priv->current_region->scale == 0)
                priv->current_region->scale = 1.0;
            priv->redraw = true;
        }
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

static gboolean buttonrelease_cb(GtkWidget *widget, GdkEventButton *event)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->type == GDK_BUTTON_RELEASE && event->button == 3) {
        ufsm_process(&priv->machine.machine, eDisablePan);
    } else if (event->type == GDK_BUTTON_RELEASE && event->button == 1) {
        ufsm_process(&priv->machine.machine, eLMBUp);
    }

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }
    return TRUE;
}

static gboolean scroll_event_cb(GtkWidget *widget, GdkEventScroll *event)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    if (event->direction == GDK_SCROLL_UP)
        canvas_machine_process(&priv->machine, eScrollUp);
    else if (event->direction == GDK_SCROLL_DOWN)
        canvas_machine_process(&priv->machine, eScrollDown);

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }

    return TRUE;
}

static gboolean motion_notify_event_cb(GtkWidget      *widget,
                                       GdkEventMotion *event,
                                       gpointer        data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    double px = event->x / priv->current_region->scale;
    double py = event->y / priv->current_region->scale;
    priv->px = px;
    priv->py = py;

    priv->dx = px - priv->sx;
    priv->dy = py - priv->sy;

    //L_DEBUG("dx %.2f dy %.2f", priv->dx, priv->dy);

    ufsm_process(&priv->machine.machine, eMotion);

    if (priv->redraw) {
        gtk_widget_queue_draw(priv->widget);
        priv->redraw = false;
    }

    return TRUE;
}

static void draw_cb(GtkWidget *widget, cairo_t *cr, gpointer data)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    gint width, height;
    gint i;
    GtkAllocation allocation;

    gtk_widget_get_allocation(widget, &allocation);

    width = allocation.width;
    height = allocation.height;

    priv->cr = cr;
    ufsmm_canvas_render(priv, width, height);
}

static void debug_event(int ev)
{
    if (ev == eMotion)
        return;

    printf (" %-3i|            |\n",ev);
}

GtkWidget* ufsmm_canvas_new(void)
{
    GtkWidget *widget = NULL;
    struct ufsmm_canvas *priv = NULL;

    priv = malloc(sizeof(*priv));

    if (priv == NULL) {
        return NULL;
    }

    memset(priv, 0, sizeof(*priv));

    ufsm_debug_machine(&priv->machine.machine);
    priv->machine.machine.debug_event = debug_event;

    canvas_machine_initialize(&priv->machine, priv);

    widget = gtk_drawing_area_new();

    g_object_set_data(G_OBJECT(widget), "canvas private", priv);

    priv->widget = widget;

    gtk_widget_set_events (widget, gtk_widget_get_events (widget)
                                     | GDK_BUTTON_PRESS_MASK
                                     | GDK_BUTTON_RELEASE_MASK
                                     | GDK_SCROLL_MASK
                                     | GDK_POINTER_MOTION_MASK);

    /* Event signals */
    g_signal_connect(G_OBJECT(widget), "key_press_event",
                     G_CALLBACK (keypress_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "key_release_event",
                     G_CALLBACK (keyrelease_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "button_press_event",
                     G_CALLBACK (buttonpress_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "button_release_event",
                     G_CALLBACK (buttonrelease_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "button_release_event",
                     G_CALLBACK (buttonrelease_cb), NULL);

    g_signal_connect (G_OBJECT(widget), "motion-notify-event",
                    G_CALLBACK (motion_notify_event_cb), NULL);

    g_signal_connect (G_OBJECT(widget), "scroll_event",
                    G_CALLBACK (scroll_event_cb), NULL);

    g_signal_connect(G_OBJECT(widget), "draw", G_CALLBACK(draw_cb), NULL);

    gtk_widget_set_can_focus(widget, TRUE);
    gtk_widget_set_focus_on_click(widget, TRUE);
    gtk_widget_grab_focus(widget);

    return widget;
}

void ufsmm_canvas_free(GtkWidget *widget)
{
}

int ufsmm_canvas_load_model(GtkWidget *widget, struct ufsmm_model *model)
{
    struct ufsmm_canvas *priv = 
                    g_object_get_data(G_OBJECT(widget), "canvas private");

    priv->model = model;
    priv->selected_region = model->root;
    priv->current_region = model->root;
    priv->current_region->draw_as_root = true;
    priv->current_region->scale = 1.0;

    return 0;
}
