#include <math.h>
#include <time.h>
#include <ufsm/model.h>

#include "canvas/controller.h"
#include "canvas/view.h"

#include "gui/edit_state_dialog.h"
#include "gui/add_action_dialog.h"
#include "gui/edit_string_dialog.h"
#include "gui/set_trigger_dialog.h"

static struct ufsmm_model *model;
static struct ufsmm_region *current_region;
static double selection_start_x, selection_start_y;
static double sselection_x, sselection_y;
static double canvas_ox, canvas_oy;
static bool pan_mode;
static GtkWidget *window;

/* Selected state variables */
static struct ufsmm_state *selected_state = NULL;
static enum ufsmm_resize_selector selected_state_corner;
static struct ufsmm_action_ref *selected_action_ref = NULL;

/* Selected region variables */
static struct ufsmm_region *selected_region = NULL;
static enum ufsmm_resize_selector selected_region_corner;

/* Create transition variables */
static bool add_vertice_flag;
static struct ufsmm_state *source_state, *dest_state;
static double source_offset, dest_offset;
static enum ufsmm_side source_side, dest_side;
static struct ufsmm_vertice *new_transition_vertice;
static struct ufsmm_vertice *new_transition_vertice_last;
static struct ufsmm_transition *selected_transition = NULL;
static enum ufsmm_transition_vertice_kind selected_vertice_kind;
static struct ufsmm_vertice *selected_transition_vertice = NULL;

/* Create state variables */
static double new_state_sx, new_state_sy;
static double new_state_ex, new_state_ey;

/* Text block variables */
static struct ufsmm_coords *selected_text_block;
static enum ufsmm_resize_selector selected_text_block_corner;

static const char *filename;

enum ufsmm_controller_state {
    STATE_IDLE,
    STATE_ADD,
    STATE_ADD_TRANSITION,
    STATE_ADD_TRANSITION2,
    STATE_ADD_STATE1,
    STATE_ADD_STATE2,
    STATE_ADD_ENTRY,
    STATE_ADD_EXIT,
    STATE_ADD_ACTION,
    STATE_ADD_GUARD,
    STATE_ADD_INIT_STATE,
    STATE_ADD_REGION,
    STATE_ADD_FINAL,
    STATE_ADD_SHALLOW_HISTORY,
    STATE_ADD_DEEP_HISTORY,
};

static enum ufsmm_controller_state controller_state;

static void draw_cb(GtkWidget *widget, cairo_t *cr, gpointer data)
{
    int rc;
    gint width, height;
    gint i;
    GtkAllocation allocation;
    struct timespec ts;
    uint64_t r_time;
    clock_gettime(CLOCK_MONOTONIC, &ts);

    r_time = ts.tv_sec*1e3 + ts.tv_nsec / 1e6;

    gtk_widget_get_allocation(widget, &allocation);

    width = allocation.width;
    height = allocation.height;

    ufsmm_canvas_render(cr, current_region, width, height);

    clock_gettime(CLOCK_MONOTONIC, &ts);

    r_time = (ts.tv_sec*1e3 + ts.tv_nsec / 1e6) - r_time;
   // printf("render %ld ms\n", r_time);
}

gboolean keyrelease_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    if (event->keyval == GDK_KEY_Shift_L)
    {
        add_vertice_flag = false;
        return TRUE;
    }
}

gboolean keypress_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    int rc;
    if (event->keyval == GDK_KEY_Escape)
        controller_state = STATE_IDLE;

check_new_state:

    if (controller_state == STATE_ADD) {
        if (event->keyval == GDK_KEY_t) {
            controller_state = STATE_ADD_TRANSITION;
        } else if (event->keyval == GDK_KEY_s) {
            controller_state = STATE_ADD_STATE1;
        } else if (event->keyval == GDK_KEY_f) {
            controller_state = STATE_ADD_FINAL;
        } else if (event->keyval == GDK_KEY_h) {
            controller_state = STATE_ADD_SHALLOW_HISTORY;
        } else if (event->keyval == GDK_KEY_y) {
            controller_state = STATE_ADD_DEEP_HISTORY;
        } else if (event->keyval == GDK_KEY_i) {
            controller_state = STATE_ADD_INIT_STATE;
        } else if (event->keyval == GDK_KEY_x && selected_state) {
            controller_state = STATE_ADD_EXIT;
        } else if (event->keyval == GDK_KEY_e && selected_state) {
            controller_state = STATE_ADD_ENTRY;
        } else if (event->keyval == GDK_KEY_r && selected_state) {
            controller_state = STATE_ADD_REGION;
        } else if (event->keyval == GDK_KEY_a && selected_transition) {
            controller_state = STATE_ADD_ACTION;
        } else if (event->keyval == GDK_KEY_g && selected_transition) {
            controller_state = STATE_ADD_GUARD;
        } else {
            controller_state = STATE_IDLE;
        }
        goto check_new_state;

    } else if (controller_state == STATE_ADD_TRANSITION) {
        L_DEBUG("Add new transition");
    } else if (controller_state == STATE_ADD_TRANSITION2) {
        if (event->keyval == GDK_KEY_Shift_L)
            add_vertice_flag = true;
    } else if (controller_state == STATE_ADD_REGION) {
        struct ufsmm_region *new_region = NULL;
        rc = ufsmm_add_region(selected_state, false, &new_region);
        new_region->name = strdup("New region");
        new_region->h = 40;
        L_DEBUG("Created new region");
        gtk_widget_queue_draw (widget);
        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_STATE1) {
        L_DEBUG("Add new state");
    } else if (controller_state == STATE_ADD_ENTRY) {
        rc = ufsm_add_entry_action_dialog(GTK_WINDOW(window), model, selected_state);
        L_DEBUG("Add entry on state %s %i", selected_state->name, rc);
        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_EXIT) {
        rc = ufsm_add_exit_action_dialog(GTK_WINDOW(window), model, selected_state);
        L_DEBUG("Add exit on state %s %i", selected_state->name, rc);
        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_ACTION) {
        rc = ufsm_add_transition_action_dialog(GTK_WINDOW(window), model,
                                                selected_transition);

        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_GUARD) {
        rc = ufsm_add_transition_guard_dialog(GTK_WINDOW(window), model,
                                                selected_transition);

        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_IDLE) {
        if (event->keyval == GDK_KEY_A)
        {
            if (current_region->parent_state) {
                L_DEBUG("Ascending to region: %s",
                        current_region->parent_state->parent_region->name);
                current_region->draw_as_root = false;
                do {
                    if (!current_region->parent_state)
                        break;
                    current_region = current_region->parent_state->parent_region;
                } while (!current_region->off_page);
                current_region->draw_as_root = true;
            }
            gtk_widget_queue_draw (widget);
        }

        if (event->keyval == GDK_KEY_e) {
            if (selected_action_ref) {
                L_DEBUG("Edit '%s'", selected_action_ref->act->name);

                ufsm_edit_string_dialog(GTK_WINDOW(window), "Edit action function",
                                            &selected_action_ref->act->name);
            } else if (selected_state) {
                L_DEBUG("Edit state");

                ufsm_edit_string_dialog(GTK_WINDOW(window), "Edit state name",
                                            &selected_state->name);
            } else if (selected_region) {
                ufsm_edit_string_dialog(GTK_WINDOW(window), "Edit region name",
                                            &selected_region->name);
            }
        }

        if ((event->keyval == GDK_KEY_t) && selected_transition) {
            L_DEBUG("Set transition trigger");
            ufsm_set_trigger_dialog(GTK_WINDOW(window), model,
                                                selected_transition);
        }

        if (event->keyval == GDK_KEY_a)
        {
            controller_state = STATE_ADD;
        }

        if (event->keyval == GDK_KEY_Delete)
        {
            if (selected_transition && !selected_action_ref) {
                if (selected_transition->focus) {
                    L_DEBUG("Deleting transition from source: %s", selected_transition->source.state->name);
                    ufsmm_state_delete_transition(selected_transition);
                    gtk_widget_queue_draw(widget);
                }
            } else if (selected_action_ref) {
                struct ufsmm_action_ref *ar = selected_action_ref;
                if (ar->focus) {
                    L_DEBUG("Delete action, kind = %i", ar->act->kind);
                    if (ar->act->kind == UFSMM_ACTION_ENTRY) {
                        L_DEBUG("Delete entry '%s' on state '%s'",
                                ar->act->name, selected_state->name);
                        ufsmm_state_delete_entry(selected_state, ar->act->id);
                    } else if (ar->act->kind == UFSMM_ACTION_EXIT) {
                        L_DEBUG("Delete exit '%s' on state '%s'",
                                ar->act->name, selected_state->name);
                        ufsmm_state_delete_exit(selected_state, ar->act->id);
                    } else if (ar->act->kind == UFSMM_ACTION_GUARD) {
                        L_DEBUG("Delete guard '%s'", ar->act->name);
                        ufsmm_transition_delete_guard(selected_transition, ar->act->id);
                    } else if (ar->act->kind == UFSMM_ACTION_ACTION) {
                        L_DEBUG("Delete action '%s'", ar->act->name);
                        ufsmm_transition_delete_action(selected_transition, ar->act->id);
                    }

                    gtk_widget_queue_draw (widget);
                }
            } else if (selected_state) {
                if (selected_state->focus) {
                    L_DEBUG("Deleting state '%s'", selected_state->name);
                    ufsmm_model_delete_state(model, selected_state);
                    selected_state = NULL;
                    gtk_widget_queue_draw(widget);
                }
            } else if (selected_region) {
                if ((!selected_region->draw_as_root) &&
                            (!selected_region->off_page)) {
                    struct ufsmm_region *pr = NULL;
                    if (selected_region->parent_state) {
                        pr = selected_region->parent_state->parent_region;
                    } else {
                        pr = model->root;
                    }

                    ufsmm_model_delete_region(model, selected_region);
                    selected_region = pr;
                    gtk_widget_queue_draw(widget);
                }
            }
        }

        if (event->keyval == GDK_KEY_Z)
        {
            ufsmm_canvas_scale(0.1);
            gtk_widget_queue_draw (widget);
        }

        if ((event->keyval == GDK_KEY_O) && selected_region)
        {
            L_DEBUG("Setting region to off-page");
            selected_region->off_page = true;
            gtk_widget_queue_draw (widget);
        }
        if (event->keyval == GDK_KEY_z)
        {
            ufsmm_canvas_scale(-0.1);
            gtk_widget_queue_draw (widget);
        }

        if (event->keyval == GDK_KEY_s)
        {
            printf("Saving...\n");
            ufsmm_model_write(filename, model);
        }

        if (event->keyval == GDK_KEY_Up)
        {
            printf("Key up\n");
            return TRUE;
        }

    }

    return TRUE;
}


static gboolean motion_notify_event_cb (GtkWidget      *widget,
                                        GdkEventMotion *event,
                                        gpointer        data)
{
    double tx_tmp, ty_tmp;
    double dx, dy;
    static double stx, sty;

    tx_tmp = ufsmm_canvas_nearest_grid_point(event->x / ufsmm_canvas_get_scale());
    ty_tmp = ufsmm_canvas_nearest_grid_point(event->y / ufsmm_canvas_get_scale());

    dx = tx_tmp - stx;
    dy = ty_tmp - sty;

    if (dx == 0 && dy == 0)
        return TRUE;

    if ((selected_region && (event->state & GDK_BUTTON1_MASK)) &&
            (selected_state_corner == UFSMM_NO_SELECTION) &&
            (selected_region_corner == UFSMM_NO_SELECTION)) {
        //printf("Multi selection!\n");
        ufsmm_canvas_set_selection(true, (selection_start_x - canvas_ox) / ufsmm_canvas_get_scale(),
                                        (selection_start_y - canvas_oy) / ufsmm_canvas_get_scale(),
                                        tx_tmp - canvas_ox / ufsmm_canvas_get_scale(),
                                        ty_tmp - canvas_oy / ufsmm_canvas_get_scale());


        gtk_widget_queue_draw (widget);
    } else if (selected_transition && selected_text_block &&
                (selected_text_block_corner == UFSMM_NO_SELECTION)) {
        L_DEBUG("Move text block");
        selected_text_block->x += dx;
        selected_text_block->y += dy;
        gtk_widget_queue_draw (widget);
    } else if (selected_transition && selected_text_block &&
                (selected_text_block_corner != UFSMM_NO_SELECTION)) {
        switch (selected_text_block_corner) {
            case UFSMM_TOP_LEFT:
                selected_text_block->x += dx;
                selected_text_block->w -= dx;
                selected_text_block->y += dy;
                selected_text_block->h -= dy;
            break;
            case UFSMM_TOP_RIGHT:
                selected_text_block->w += dx;
                selected_text_block->y += dy;
                selected_text_block->h -= dy;
            break;
            case UFSMM_BOT_RIGHT:
                selected_text_block->w += dx;
                selected_text_block->h += dy;
            break;
            case UFSMM_BOT_LEFT:
                selected_text_block->x += dx;
                selected_text_block->w -= dx;
                selected_text_block->h += dy;
            break;
            default:
            break;
        }

        if (selected_text_block->h < 20)
            selected_text_block->h = 20;

        if (selected_text_block->w < 50)
            selected_text_block->w = 50;

        gtk_widget_queue_draw (widget);
    } else if (selected_transition &&
               (selected_vertice_kind != UFSMM_TRANSITION_VERTICE_NONE) &&
               (event->state & GDK_BUTTON1_MASK))
    {
        L_DEBUG("Move transition vertice %i", selected_vertice_kind);

        switch (selected_vertice_kind) {
            case UFSMM_TRANSITION_VERTICE_START:
            {
                enum ufsmm_side src_side;
                double src_offset;

                ufsmm_state_get_closest_side(selected_transition->source.state,
                                             tx_tmp, ty_tmp,
                                             &src_side,
                                             &src_offset);

                if (selected_transition->source.side != src_side) {
                    selected_transition->source.side = src_side;
                    selected_transition->source.offset = src_offset;
                }

                if (selected_transition->source.side == UFSMM_SIDE_LEFT ||
                    selected_transition->source.side == UFSMM_SIDE_RIGHT) {
                    selected_transition->source.offset += dy;
                } else {
                    selected_transition->source.offset += dx;
                }
            }
            break;
            case UFSMM_TRANSITION_VERTICE_END:
            {
                enum ufsmm_side dest_side;
                double dest_offset;

                ufsmm_state_get_closest_side(selected_transition->dest.state,
                                             tx_tmp, ty_tmp,
                                             &dest_side,
                                             &dest_offset);

                if (selected_transition->dest.side != dest_side) {
                    L_DEBUG("Changing side from %i to %i",
                        selected_transition->dest.side, dest_side);
                    selected_transition->dest.side = dest_side;
                    selected_transition->dest.offset = dest_offset;
                }

                if (selected_transition->dest.side == UFSMM_SIDE_LEFT ||
                    selected_transition->dest.side == UFSMM_SIDE_RIGHT) {
                    selected_transition->dest.offset += dy;
                } else {
                    selected_transition->dest.offset += dx;
                }
            }
            break;
            case UFSMM_TRANSITION_VERTICE:
                selected_transition_vertice->y += dy;
                selected_transition_vertice->x += dx;

                selected_transition_vertice->y =
                    ufsmm_canvas_nearest_grid_point(selected_transition_vertice->y);

                selected_transition_vertice->x =
                    ufsmm_canvas_nearest_grid_point(selected_transition_vertice->x);
            break;
            default:
            break;
        }

        selected_transition->source.offset = \
           ufsmm_canvas_nearest_grid_point(selected_transition->source.offset);
        selected_transition->dest.offset = \
           ufsmm_canvas_nearest_grid_point(selected_transition->dest.offset);

        gtk_widget_queue_draw (widget);
    } else if (selected_region && (selected_region_corner != UFSMM_NO_SELECTION)) {
        L_DEBUG("Region resize");
        switch (selected_region_corner) {
            case UFSMM_BOT_MIDDLE:
                if (selected_region->h == -1)
                    selected_region->h = dy;
                else
                    selected_region->h += dy;

                if (selected_region->h < 50)
                    selected_region->h = 50;
            break;
            default:
            break;
        }
        gtk_widget_queue_draw (widget);
    } else if (pan_mode) {
        ufsmm_canvas_pan(dx * ufsmm_canvas_get_scale(), dy * ufsmm_canvas_get_scale());
        canvas_ox += dx * ufsmm_canvas_get_scale();
        canvas_oy += dy * ufsmm_canvas_get_scale();
        gtk_widget_queue_draw (widget);
    }

    if (selected_state && (event->state & GDK_BUTTON1_MASK) &&
        (selected_state_corner != UFSMM_NO_SELECTION) &&
        (selected_state->kind == UFSMM_STATE_NORMAL)) {

        switch (selected_state_corner) {
            case UFSMM_TOP_MIDDLE:
                selected_state->h -= dy;
                selected_state->y += dy;
            break;
            case UFSMM_BOT_MIDDLE:
                selected_state->h += dy;
            break;
            case UFSMM_TOP_RIGHT:
                selected_state->h -= dy;
                selected_state->w += dx;
                selected_state->y += dy;
            break;
            case UFSMM_RIGHT_MIDDLE:
                selected_state->w += dx;
            break;
            case UFSMM_LEFT_MIDDLE:
                selected_state->w -= dx;
                selected_state->x += dx;
            break;
            case UFSMM_BOT_RIGHT:
                selected_state->w += dx;
                selected_state->h += dy;
            break;
            case UFSMM_BOT_LEFT:
                selected_state->w -= dx;
                selected_state->x += dx;
                selected_state->h += dy;
            break;
            case UFSMM_TOP_LEFT:
                selected_state->w -= dx;
                selected_state->x += dx;
                selected_state->h -= dy;
                selected_state->y += dy;
            break;
        }

        if (selected_state->w < 50)
            selected_state->w = 50;

        if (selected_state->h < 50)
            selected_state->h = 50;

        selected_state->x = ufsmm_canvas_nearest_grid_point(selected_state->x);
        selected_state->y = ufsmm_canvas_nearest_grid_point(selected_state->y);
        selected_state->w = ufsmm_canvas_nearest_grid_point(selected_state->w);
        selected_state->h = ufsmm_canvas_nearest_grid_point(selected_state->h);

        gtk_widget_queue_draw (widget);
    } else if (selected_state && (event->state & GDK_BUTTON1_MASK) &&
               (selected_action_ref == NULL)) {

        struct ufsmm_region *new_pr;
        double x, y, w, h;
        double ox, oy;
        int rc;
        printf("move %s --> %f %f\n", selected_state->name, dx, dy);

        rc = ufsmm_region_get_at_xy(current_region, tx_tmp, ty_tmp, &new_pr, NULL);

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

        ufsmm_canvas_state_translate(selected_state, dx, dy);
        gtk_widget_queue_draw (widget);
    }

    stx = tx_tmp;
    sty = ty_tmp;
    return TRUE;
}

gboolean buttonrelease_cb(GtkWidget *widget, GdkEventButton *event)
{
    ufsmm_canvas_set_selection(false, 0, 0, 0, 0);
    pan_mode = false;
    selected_text_block = NULL;
    selected_region_corner = UFSMM_NO_SELECTION;
    gtk_widget_queue_draw (widget);
    return TRUE;
}

gboolean buttonpress_cb(GtkWidget *widget, GdkEventButton *event)
{
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    double x, y, w, h;
    bool last_object_state = false;
    double ox, oy;
    bool edit_object = false;
    int rc;

/*
    printf("%s %f %f\n", __func__,
                       event->x,
                       event->y);*/

    if (event->type == GDK_DOUBLE_BUTTON_PRESS)
        edit_object = true;

    gtk_widget_grab_focus(widget);

    double px = event->x / ufsmm_canvas_get_scale();
    double py = event->y / ufsmm_canvas_get_scale();

    selection_start_y = event->y;
    selection_start_x = event->x;

    ufsmm_canvas_get_offset(&ox, &oy);

    ox = ox / ufsmm_canvas_get_scale();
    oy = oy / ufsmm_canvas_get_scale();


    if (event->type == GDK_BUTTON_PRESS &&
        event->button == 3) {
        pan_mode = true;
        return TRUE;
    }

    selected_action_ref = NULL;

    if (controller_state == STATE_ADD_TRANSITION) {
        L_DEBUG("Looking for source state at <%f, %f>", px, py);

        rc = ufsmm_state_get_at_xy(current_region, px, py, &source_state, NULL);

        if (rc == UFSMM_OK) {
            controller_state = STATE_ADD_TRANSITION2;
            ufsmm_state_get_closest_side(source_state, px, py, &source_side,
                                        &source_offset);
            L_DEBUG("Side = %i", source_side);
        } else {
            controller_state = STATE_IDLE;
        }
        new_transition_vertice = NULL;

        return TRUE;
    } else if (controller_state == STATE_ADD_TRANSITION2) {
        if (add_vertice_flag) {
            L_DEBUG("Add vertice at <%f, %f>", px, py);

            if (new_transition_vertice == NULL) {
                new_transition_vertice = malloc(sizeof(*new_transition_vertice));
                memset(new_transition_vertice, 0, sizeof(*new_transition_vertice));
                new_transition_vertice_last = new_transition_vertice;
            } else {
                new_transition_vertice_last->next = malloc(sizeof(*new_transition_vertice));
                new_transition_vertice_last = new_transition_vertice_last->next;
                memset(new_transition_vertice_last, 0, sizeof(*new_transition_vertice_last));
            }

            ufsmm_get_region_absolute_coords(selected_region, &x, &y, &w, &h);
            new_transition_vertice_last->x = 
                ufsmm_canvas_nearest_grid_point(px) - (x + ox);
            new_transition_vertice_last->y =
                ufsmm_canvas_nearest_grid_point(py) - (y + oy);

        } else {
            L_DEBUG("Looking for dest state at <%f, %f>", px, py);

            rc = ufsmm_state_get_at_xy(current_region, px, py, &dest_state, NULL);

            if (rc == UFSMM_OK) {

                ufsmm_state_get_closest_side(dest_state, px, py, &dest_side,
                                            &dest_offset);
                L_DEBUG("Creating transition %s --> %s", source_state->name,
                                                         dest_state->name);
                struct ufsmm_transition *new_transition;
                ufsmm_state_add_transition(source_state, dest_state, &new_transition);
                new_transition->source.side = source_side;
                new_transition->source.offset = source_offset;
                new_transition->dest.side = dest_side;
                new_transition->dest.offset = dest_offset;
                new_transition->text_block_coords.x = source_state->x;
                new_transition->text_block_coords.y = source_state->y;
                new_transition->text_block_coords.w = 100;
                new_transition->text_block_coords.h = 30;
                new_transition->vertices = new_transition_vertice;
            }
            controller_state = STATE_IDLE;
        }
        return TRUE;
    } else if (controller_state == STATE_ADD_STATE1) {
        L_DEBUG("Top left <%f, %f>", px, py);
        new_state_sx = ufsmm_canvas_nearest_grid_point(px);
        new_state_sy = ufsmm_canvas_nearest_grid_point(py);
        controller_state = STATE_ADD_STATE2;
        return TRUE;
    } else if (controller_state == STATE_ADD_STATE2) {
        L_DEBUG("Bottom right <%f, %f> %p", px, py, selected_region);
        new_state_ex = ufsmm_canvas_nearest_grid_point(px);
        new_state_ey = ufsmm_canvas_nearest_grid_point(py);
        struct ufsmm_state *new_state = NULL;
        rc = ufsmm_add_state(selected_region, "New state", &new_state);
        if (rc == UFSMM_OK) {
            ufsmm_get_region_absolute_coords(selected_region, &x, &y, &w, &h);
            new_state->x = new_state_sx - (x + ox);
            new_state->y = new_state_sy - (y + oy);
            new_state->w = new_state_ex - new_state_sx;
            new_state->h = new_state_ey - new_state_sy;
            L_DEBUG("Created new state, pr = %s", selected_region->name);
        } else {
            L_ERR("Could not create new state");
        }
        controller_state = STATE_IDLE;
        return TRUE;
    } else if (controller_state == STATE_ADD_INIT_STATE) {
        new_state_sx = ufsmm_canvas_nearest_grid_point(px);
        new_state_sy = ufsmm_canvas_nearest_grid_point(py);
        struct ufsmm_state *new_state = NULL;
        rc = ufsmm_add_state(selected_region, "Init", &new_state);

        if (rc == UFSMM_OK) {
            ufsmm_get_region_absolute_coords(selected_region, &x, &y, &w, &h);
            L_DEBUG("x, y = <%.2f, %.2f>, new_state_xy = <%.2f, %.2f>",
                        x, y, new_state_sx, new_state_sy);
            new_state->x = new_state_sx - (x + ox);
            new_state->y = new_state_sy - (y + oy);
            new_state->w = 20;
            new_state->h = 20;
            new_state->kind = UFSMM_STATE_INIT;
            L_DEBUG("Created new state, pr = %s", selected_region->name);
        } else {
            L_ERR("Could not create new state");
        }
        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_FINAL) {
        L_DEBUG("Adding final state");
        new_state_sx = ufsmm_canvas_nearest_grid_point(px);
        new_state_sy = ufsmm_canvas_nearest_grid_point(py);
        struct ufsmm_state *new_state = NULL;
        rc = ufsmm_add_state(selected_region, "Final", &new_state);

        if (rc == UFSMM_OK) {
            ufsmm_get_region_absolute_coords(selected_region, &x, &y, &w, &h);
            L_DEBUG("x, y = <%.2f, %.2f>, new_state_xy = <%.2f, %.2f>",
                        x, y, new_state_sx, new_state_sy);
            new_state->x = new_state_sx - (x + ox);
            new_state->y = new_state_sy - (y + oy);
            new_state->w = 20;
            new_state->h = 20;
            new_state->kind = UFSMM_STATE_FINAL;
            L_DEBUG("Created new state, pr = %s", selected_region->name);
        } else {
            L_ERR("Could not create new state");
        }
        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_SHALLOW_HISTORY) {
        L_DEBUG("Adding shallow history state");
        new_state_sx = ufsmm_canvas_nearest_grid_point(px);
        new_state_sy = ufsmm_canvas_nearest_grid_point(py);
        struct ufsmm_state *new_state = NULL;
        rc = ufsmm_add_state(selected_region, "Shallow History", &new_state);

        if (rc == UFSMM_OK) {
            ufsmm_get_region_absolute_coords(selected_region, &x, &y, &w, &h);
            L_DEBUG("x, y = <%.2f, %.2f>, new_state_xy = <%.2f, %.2f>",
                        x, y, new_state_sx, new_state_sy);
            new_state->x = new_state_sx - (x + ox);
            new_state->y = new_state_sy - (y + oy);
            new_state->w = 20;
            new_state->h = 20;
            new_state->kind = UFSMM_STATE_SHALLOW_HISTORY;
            L_DEBUG("Created new state, pr = %s", selected_region->name);
        } else {
            L_ERR("Could not create new state");
        }
        controller_state = STATE_IDLE;
    } else if (controller_state == STATE_ADD_DEEP_HISTORY) {
        L_DEBUG("Adding deep history state");
        new_state_sx = ufsmm_canvas_nearest_grid_point(px);
        new_state_sy = ufsmm_canvas_nearest_grid_point(py);
        struct ufsmm_state *new_state = NULL;
        rc = ufsmm_add_state(selected_region, "Deep History", &new_state);

        if (rc == UFSMM_OK) {
            ufsmm_get_region_absolute_coords(selected_region, &x, &y, &w, &h);
            L_DEBUG("x, y = <%.2f, %.2f>, new_state_xy = <%.2f, %.2f>",
                        x, y, new_state_sx, new_state_sy);
            new_state->x = new_state_sx - (x + ox);
            new_state->y = new_state_sy - (y + oy);
            new_state->w = 20;
            new_state->h = 20;
            new_state->kind = UFSMM_STATE_DEEP_HISTORY;
            L_DEBUG("Created new state, pr = %s", selected_region->name);
        } else {
            L_ERR("Could not create new state");
        }
        controller_state = STATE_IDLE;
    }

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, current_region);

    selected_region_corner = UFSMM_NO_SELECTION;

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        r->focus = false;
        ufsmm_get_region_absolute_coords(r, &x, &y, &w, &h);

        if (selected_region_corner != UFSMM_NO_SELECTION)
            continue;

        x += ox;
        y += oy;

        L_DEBUG("Checking region '%s' %f, %f, %f, %f", r->name,
                        x, y, w ,h);
        if ( (px > (x + 5)) && (px < (x + w - 5)) &&
             (py > (y)) && (py < (y + h))) {

             L_DEBUG("Region '%s' selected", r->name);
             selected_region = r;
             last_object_state = false;
        }

        /* Check region resize boxes */
        if (selected_region) {
            if (point_in_box(px, py, x + w/2 - 5, y + h - 5, 20, 20)) {
                L_DEBUG("Region bottom resize box");
                selected_region_corner = UFSMM_BOT_MIDDLE;
            } else {
                selected_region_corner = UFSMM_NO_SELECTION;
            }
        } else {
            selected_region_corner = UFSMM_NO_SELECTION;
        }

        if (r->off_page && !r->draw_as_root)
            continue;

        for (s = r->state; s; s = s->next)
        {
            s->focus = false;
            ufsmm_get_state_absolute_coords(s, &x, &y, &w, &h);

            x += ox;
            y += oy;

            L_DEBUG("Checking state '%s'", s->name);
            if ( (px > (x-5)) && (px < (x + w + 5)) &&
                 (py > (y-5)) && (py < (y + h + 5))) {

                 L_DEBUG("State '%s' selected", s->name);
                 selected_state = s;
                 last_object_state = true;

            }

            for (struct ufsmm_action_ref *ar = s->exits; ar; ar = ar->next)
                ar->focus = false;
            for (struct ufsmm_action_ref *ar = s->entries; ar; ar = ar->next)
                ar->focus = false;

            for (r2 = s->regions; r2; r2 = r2->next)
            {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    if (edit_object && !last_object_state && selected_region) {
        if (selected_region->off_page) {
            L_DEBUG("Switching view to region: %s", selected_region->name);
            current_region->draw_as_root = false;
            current_region = selected_region;
            current_region->draw_as_root = true;
            goto controller_out;
        }
    }

    if (selected_state != NULL && last_object_state) {
         L_DEBUG("State %s selected, pr = %s", selected_state->name,
                    selected_state->parent_region->name);
        selected_state->focus = true;
        selected_region = NULL;
        selected_state->parent_region->focus = false;
        sselection_x = selected_state->x;
        sselection_y = selected_state->y;

        if (selected_state->kind == UFSMM_STATE_NORMAL) {
            ufsmm_get_state_absolute_coords(selected_state, &x, &y, &w, &h);

            x += ox;
            y += oy;

            /* Check re-size boxes */
            if (point_in_box(px, py, x, y, 10, 10)) {
                L_DEBUG("Top left corner!");
                selected_state_corner = UFSMM_TOP_LEFT;
            } else if (point_in_box(px, py, x + w, y, 10, 10)) {
                L_DEBUG("Top right corner!");
                selected_state_corner = UFSMM_TOP_RIGHT;
            } else if (point_in_box(px, py, x + w/2, y, 10, 10)) {
                L_DEBUG("Top middle");
                selected_state_corner = UFSMM_TOP_MIDDLE;
            } else if (point_in_box(px, py, x, y + h/2, 10, 10)) {
                L_DEBUG("Left middle");
                selected_state_corner = UFSMM_LEFT_MIDDLE;
            } else if (point_in_box(px, py, x, y + h, 10, 10)) {
                L_DEBUG("Bottom left corner");
                selected_state_corner = UFSMM_BOT_LEFT;
            } else if (point_in_box(px, py, x + w/2, y + h, 10, 10)) {
                L_DEBUG("Bottom middle");
                selected_state_corner = UFSMM_BOT_MIDDLE;
            } else if (point_in_box(px, py, x + w, y + h, 10, 10)) {
                L_DEBUG("Bottom right corner");
                selected_state_corner = UFSMM_BOT_RIGHT;
            } else if (point_in_box(px, py, x + w, y + h/2, 10, 10)) {
                L_DEBUG("Right middle");
                selected_state_corner = UFSMM_RIGHT_MIDDLE;
            } else {
                selected_state_corner = UFSMM_NO_SELECTION;
            }

            if (selected_state_corner == UFSMM_NO_SELECTION) {
                /*last_object_state = false;
                selected_state = NULL;
                if (selected_region) {
                    selected_region->focus = true;
                }*/
            } else {
                selected_region = NULL;
                last_object_state = true;
            }

            /* Check action functions */
            for (struct ufsmm_action_ref *ar = selected_state->entries; ar; ar = ar->next) {
                if (point_in_box2(px, py, ar->x + ox, ar->y + oy, ar->w, ar->h)) {
                    L_DEBUG("%s selected", ar->act->name);
                    ar->focus = true;
                    selected_action_ref = ar;
                } else {
                    ar->focus = false;
                }
            }

            for (struct ufsmm_action_ref *ar = selected_state->exits; ar; ar = ar->next) {
                if (point_in_box2(px, py, ar->x + ox, ar->y + oy, ar->w, ar->h)) {
                    L_DEBUG("%s selected", ar->act->name);
                    ar->focus = true;
                    selected_action_ref = ar;
                } else {
                    ar->focus = false;
                }
            }
        }

    } else if (selected_region && !last_object_state) {
         L_DEBUG("Region %s selected!", selected_region->name);
         selected_region->focus = true;
         selected_state = NULL;
    }
    /* Check transitions selection */

    if (selected_transition) {
        selected_region = NULL;
        selected_state = NULL;
        selected_transition->focus = false;
        selected_transition = NULL;
    }

    ufsmm_stack_push(stack, current_region);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r->off_page && !r->draw_as_root)
            continue;

        for (s = r->state; s; s = s->next)
        {
            for (struct ufsmm_transition *t = s->transition; t; t = t->next) {
                struct ufsmm_vertice *v;
                double vsx, vsy, vex, vey;
                double tsx, tsy, tex, tey;
                double d;
                bool t_focus = false;
                L_DEBUG("Checking transitions from %s", s->name);
                t->focus = false;
                transition_calc_begin_end_point(s,
                                                t->source.side,
                                                t->source.offset,
                                                &tsx, &tsy);
                transition_calc_begin_end_point(t->dest.state,
                                                t->dest.side,
                                                t->dest.offset,
                                                &tex, &tey);
                vsx = tsx + ox;
                vsy = tsy + oy;

                if (t->vertices) {
                    for (v = t->vertices; v; v = v->next) {
                        vex = v->x + ox;
                        vey = v->y + oy;

                        d = distance_point_to_seg(px, py,
                                                  vsx, vsy,
                                                  vex, vey);


                        if (d < 10.0) {
                            t_focus = true;
                            break;
                        }
                        vsx = v->x + ox;
                        vsy = v->y + oy;
                    }
                    vsx = vex;
                    vsy = vey;
                }
                vex = tex + ox;
                vey = tey + oy;

                d = distance_point_to_seg(px, py,
                                          vsx, vsy,
                                          vex, vey);
                if (d < 10.0)
                    t_focus = true;

                ufsmm_get_region_absolute_coords(t->source.state->parent_region,
                                                   &x, &y, &w, &h);
                double tx = t->text_block_coords.x + x + ox;
                double ty = t->text_block_coords.y + y + oy;
                double tw = t->text_block_coords.w;
                double th = t->text_block_coords.h;

                if (point_in_box2(px, py, tx - 10, ty - 10, tw + 20, th + 20)) {
                    L_DEBUG("Text-box selected <%.2f, %.2f> <%.2f, %.2f, %.2f, %.2f>",
                                px, py, tx, ty, tx + tw, ty + th);
                    t_focus = true;
                    selected_text_block = &t->text_block_coords;

                    if (point_in_box(px, py, tx, ty, 10, 10)) {
                        selected_text_block_corner = UFSMM_TOP_LEFT;
                    } else if (point_in_box(px, py, tx + tw, ty, 10, 10)) {
                        selected_text_block_corner = UFSMM_TOP_RIGHT;
                    } else if (point_in_box(px, py, tx + tw, ty + th, 10, 10)) {
                        selected_text_block_corner = UFSMM_BOT_RIGHT;
                    } else if (point_in_box(px, py, tx, ty + th, 10, 10)) {
                        selected_text_block_corner = UFSMM_BOT_LEFT;
                    } else {
                        selected_text_block_corner = UFSMM_NO_SELECTION;
                    }
                }
                /* Check guards */

                for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next)
                    ar->focus = false;

                for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next)
                    ar->focus = false;

                for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next) {
                    if (point_in_box2(px, py, ar->x + ox, ar->y + oy, ar->w, ar->h)) {
                        ar->focus = true;
                        selected_action_ref = ar;
                    }
                }

                for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next) {
                    if (point_in_box2(px, py, ar->x + ox, ar->y + oy, ar->w, ar->h)) {
                        ar->focus = true;
                        selected_action_ref = ar;
                    }
                }
                if (t_focus) {
                    selected_transition = t;
                    if (selected_state)
                        selected_state->focus = false;
                    if (selected_region)
                        selected_region->focus = false;
                }
            }
            for (r2 = s->regions; r2; r2 = r2->next)
            {

                ufsmm_stack_push(stack, r2);
            }
        }
    }

    if (selected_transition) {
        double vsx, vsy, vex, vey;
        double tsx, tsy, tex, tey;

        selected_transition->focus = true;
        selected_vertice_kind = UFSMM_TRANSITION_VERTICE_NONE;

        transition_calc_begin_end_point(selected_transition->source.state,
                                        selected_transition->source.side,
                                        selected_transition->source.offset,
                                        &tsx, &tsy);
        transition_calc_begin_end_point(selected_transition->dest.state,
                                        selected_transition->dest.side,
                                        selected_transition->dest.offset,
                                        &tex, &tey);

        vex = tex + ox;
        vey = tey + oy;

        vsx = tsx + ox;
        vsy = tsy + oy;

        L_DEBUG("%f %f, %f %f", px, py, vex, vey);

        if (point_in_box(px, py, vsx, vsy, 10, 10)) {
            L_DEBUG("Start vertice selected");
            selected_vertice_kind = UFSMM_TRANSITION_VERTICE_START;
        }

        for (struct ufsmm_vertice *v = selected_transition->vertices; v; v = v->next) {
            if (point_in_box(px, py, v->x + ox, v->y + oy, 10, 10)) {
                L_DEBUG("Vertice selected");
                selected_vertice_kind = UFSMM_TRANSITION_VERTICE;
                selected_transition_vertice = v;
            }
        }

        if (point_in_box(px, py, vex, vey, 10, 10)) {
            selected_vertice_kind = UFSMM_TRANSITION_VERTICE_END;
            L_DEBUG("End vertice selected");
        }

    } else {
        selected_vertice_kind = UFSMM_TRANSITION_VERTICE_NONE;
        selected_text_block = NULL;
    }


    if (selected_state && edit_object) {
        ufsm_edit_string_dialog(GTK_WINDOW(window), "Edit state name",
                                    &selected_state->name);
    }

controller_out:
    ufsmm_stack_free(stack);
    gtk_widget_queue_draw (widget);

    return TRUE;
}

int ufsmm_state_canvas_init(GtkWidget *parent, GtkWidget **canvas)
{
    GtkWidget *c = gtk_drawing_area_new();
    (*canvas) = c;
    window = parent;

    gtk_widget_set_events (c, gtk_widget_get_events (c)
                                     | GDK_BUTTON_PRESS_MASK
                                     | GDK_BUTTON_RELEASE_MASK
                                     | GDK_POINTER_MOTION_MASK);


    /* Event signals */
    g_signal_connect(G_OBJECT(c), "key_press_event",
                     G_CALLBACK (keypress_cb), NULL);

    g_signal_connect(G_OBJECT(c), "key_release_event",
                     G_CALLBACK (keyrelease_cb), NULL);

    g_signal_connect(G_OBJECT(c), "button_press_event",
                     G_CALLBACK (buttonpress_cb), NULL);

    g_signal_connect(G_OBJECT(c), "button_release_event",
                     G_CALLBACK (buttonrelease_cb), NULL);
    g_signal_connect (G_OBJECT(c), "motion-notify-event",
                    G_CALLBACK (motion_notify_event_cb), NULL);

    g_signal_connect(G_OBJECT(c), "draw", G_CALLBACK(draw_cb), NULL);

    gtk_widget_set_can_focus(c, TRUE);
    gtk_widget_set_focus_on_click(c, TRUE);
    gtk_widget_grab_focus(c);

    return UFSMM_OK;
}

int ufsmm_state_canvas_free(GtkWidget *canvas)
{
    return UFSMM_OK;
}


int ufsmm_state_canvas_update(struct ufsmm_model *model_,
                             struct ufsmm_region *region,
                             const char *filename_)
{
    model = model_;
    filename = filename_;
    current_region = model->root;
    current_region->draw_as_root = true;
    selected_region = model->root;
    return UFSMM_OK;
}
