#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ufsm/ufsm.h>
#include "menu.h"
#include "controller.h"
#include "render.h"
#include "utils.h"
#include "logic/canvas.h"

struct menu_item;

typedef void (*menu_rfunc)(struct menu *menu, struct menu_item *item);
typedef void (*menu_afunc)(struct ufsm_machine *m);

struct menu_item {
    double x, y;
    bool enabled;
    menu_rfunc render;
    menu_afunc action;
};

static void r_background(cairo_t *cr, enum ufsmm_color_theme theme,
                                 double x, double y)
{
    cairo_save(cr);
    cairo_translate(cr, x, y);
    cairo_new_sub_path(cr);
    cairo_set_line_width(cr, 4);
    ufsmm_color_set(cr, theme, UFSMM_COLOR_BG2);
    cairo_arc(cr, 0, 0, 20, 0, 2 * M_PI);
    cairo_stroke_preserve(cr);
    cairo_fill(cr);
    cairo_restore(cr);
}

void r_add_state(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_rectangle (menu->cr, x - 10, y - 10, 20, 20);
    cairo_rectangle (menu->cr, x - 10, y - 10, 20, 5);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_state(struct ufsm_machine *m)
{
    L_DEBUG("Action add state");
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_s_down);
}

void r_add_region(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    double dashes[] = {3.0,  /* ink */
                       3.0};  /* skip */
    enum ufsmm_color_theme theme = menu->theme;

    bool enabled = (menu->selection == UFSMM_SELECTION_STATE);

    item->enabled = enabled;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    if (enabled)
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    else
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_GRAY1);

    cairo_set_dash (menu->cr, dashes, 2, 0);
    cairo_rectangle (menu->cr, x - 10, y - 10, 20, 20);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_region(struct ufsm_machine *m)
{
    L_DEBUG("Action add region");
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_r_down);
}

void r_add_transition(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_move_to(menu->cr, x - 5, y + 12);
    cairo_line_to(menu->cr, x + 5, y + 2);

    cairo_move_to(menu->cr, x + 5, y + 2);
    cairo_line_to(menu->cr, x - 5, y + 3);

    cairo_move_to(menu->cr, x - 5, y + 3);
    cairo_line_to(menu->cr, x + 5, y - 10);
    cairo_stroke_preserve(menu->cr);
    cairo_fill(menu->cr);
    cairo_restore(menu->cr);

    double end_y = y - 11;
    double end_x = x + 6;
    double begin_y = y + 3;
    double begin_x = x - 5;

    /* Draw arrow */
    double angle = atan2(end_y - begin_y, end_x - begin_x) + M_PI;

    double x1 = end_x + 10 * cos(angle - 0.5);
    double y1 = end_y + 10 * sin(angle - 0.5);
    double x2 = end_x + 10 * cos(angle + 0.5);
    double y2 = end_y + 10 * sin(angle + 0.5);

    cairo_save(menu->cr);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_new_sub_path(menu->cr);
    cairo_move_to (menu->cr, end_x, end_y);
    cairo_line_to(menu->cr, x1, y1);
    cairo_line_to(menu->cr, x2, y2);
    cairo_close_path(menu->cr);
    cairo_fill(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_transition(struct ufsm_machine *m)
{
    L_DEBUG("Action add transition");
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_t_down);
}

static void r_func_name(struct menu *menu, struct menu_item *item,
                        const char *text_buf,
                        bool enabled)
{
    double x = item->x;
    double y = item->y;
    cairo_text_extents_t extents;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);
    item->enabled = enabled;

    cairo_save(menu->cr);
    cairo_set_font_size (menu->cr, 20);
    if (enabled) {
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    } else {
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_GRAY1);
    }
    cairo_text_extents(menu->cr, text_buf, &extents);
    cairo_move_to (menu->cr, x - extents.width / 2, y + extents.height/2 - 3);
    cairo_show_text (menu->cr, text_buf);
    cairo_restore(menu->cr);
}

void r_add_action(struct menu *menu, struct menu_item *item)
{
    bool enabled = (menu->selection == UFSMM_SELECTION_TRANSITION);
    r_func_name(menu, item, "a()", enabled);
}

void a_add_action(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_a_down);
}

void r_add_guard(struct menu *menu, struct menu_item *item)
{
    bool enabled = (menu->selection == UFSMM_SELECTION_TRANSITION);
    r_func_name(menu, item, "g()", enabled);
}

void a_add_guard(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_g_down);
}

void r_add_entry(struct menu *menu, struct menu_item *item)
{
    bool enabled = (menu->selection == UFSMM_SELECTION_STATE);
    r_func_name(menu, item, "e()", enabled);
}

void a_add_entry(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_e_down);
}

void r_add_exit(struct menu *menu, struct menu_item *item)
{
    bool enabled = (menu->selection == UFSMM_SELECTION_STATE);
    r_func_name(menu, item, "x()", enabled);
}

void a_add_exit(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_x_down);
}

void r_add_vertice(struct menu *menu, struct menu_item *item)
{
    bool enabled = (menu->selection == UFSMM_SELECTION_TRANSITION);
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    item->enabled = enabled;
    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    if (enabled)
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    else
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_GRAY1);
    cairo_move_to(menu->cr, x, y);
    cairo_line_to(menu->cr, x + 10, y + 10);
    cairo_move_to(menu->cr, x, y);
    cairo_line_to(menu->cr, x - 10, y + 5);
    cairo_move_to(menu->cr, x, y);
    cairo_rectangle (menu->cr, x - 3, y - 3, 6, 6);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_vertice(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_v_down);
}

void r_add_fork(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_set_line_width(menu->cr, 2);
    cairo_move_to(menu->cr, x - 10, y);
    cairo_line_to(menu->cr, x - 3, y);
    cairo_rectangle (menu->cr, x - 3, y - 7, 6, 14);
    cairo_move_to(menu->cr, x + 3, y - 3);
    cairo_line_to(menu->cr, x + 10, y - 3);
    cairo_move_to(menu->cr, x + 3, y + 3);
    cairo_line_to(menu->cr, x + 10, y + 3);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_fork(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_F_down);
}

void r_add_join(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_set_line_width(menu->cr, 2);
    cairo_move_to(menu->cr, x - 3, y - 3);
    cairo_line_to(menu->cr, x - 10, y - 3);
    cairo_move_to(menu->cr, x - 3, y + 3);
    cairo_line_to(menu->cr, x - 10, y + 3);
    cairo_rectangle (menu->cr, x - 3, y - 7, 6, 14);
    cairo_move_to(menu->cr, x + 10, y);
    cairo_line_to(menu->cr, x + 3, y);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_join(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_j_down);
}

void r_add_init(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_set_line_width(menu->cr, 2);
    cairo_arc(menu->cr, x, y, 10, 0, 2 * M_PI);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_init(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_i_down);
}

void r_add_final(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_set_line_width(menu->cr, 2);
    cairo_arc(menu->cr, x, y, 10, 0, 2 * M_PI);
    cairo_stroke(menu->cr);
    cairo_arc(menu->cr, x, y, 6, 0, 2 * M_PI);
    cairo_fill(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_final(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_f_down);
}

void r_add_terminate(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_set_line_width(menu->cr, 2);
    cairo_arc(menu->cr, x, y, 10, 0, 2 * M_PI);
    cairo_move_to(menu->cr, x - 7, y - 7);
    cairo_line_to(menu->cr, x + 7, y + 7);
    cairo_move_to(menu->cr, x + 7, y - 7);
    cairo_line_to(menu->cr, x - 7, y + 7);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_add_terminate(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_T_down);
}

void r_add_history(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    const char *text_buf = "H";
    cairo_text_extents_t extents;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    cairo_set_font_size (menu->cr, 20);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_text_extents(menu->cr, text_buf, &extents);
    cairo_move_to (menu->cr, x - extents.width / 2.0, y + extents.height/2.0);
    cairo_show_text (menu->cr, text_buf);
    cairo_restore(menu->cr);
}

void a_add_history(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_h_down);
}

void r_add_deep_history(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    const char *text_buf = "H+";
    cairo_text_extents_t extents;

    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    cairo_set_font_size (menu->cr, 20);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_YELLOW2);
    cairo_text_extents(menu->cr, text_buf, &extents);
    cairo_move_to (menu->cr, x - extents.width / 2.0, y + extents.height/2.0);
    cairo_show_text (menu->cr, text_buf);
    cairo_restore(menu->cr);
}

void a_add_deep_history(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_a_down);
    ufsm_process(m, eKey_H_down);
}

void r_delete(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    bool enabled = (menu->selection != UFSMM_SELECTION_NONE);
    r_background(menu->cr, theme, x, y);
    item->enabled = enabled;

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    if (enabled)
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_BLUE1);
    else
        ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_GRAY1);

    cairo_move_to(menu->cr, x - 10, y - 10);
    cairo_line_to(menu->cr, x + 10, y + 10);
    cairo_move_to(menu->cr, x + 10, y - 10);
    cairo_line_to(menu->cr, x - 10, y + 10);
    cairo_stroke_preserve(menu->cr);
    cairo_fill(menu->cr);
    cairo_restore(menu->cr);
}

void a_delete(struct ufsm_machine *m)
{
    L_DEBUG("Action delete");
    ufsm_process(m, eKey_delete_down);
}

void r_paste(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_BLUE1);
    cairo_rectangle(menu->cr, x - 8, y - 10, 16, 20);
    cairo_move_to(menu->cr, x - 6, y - 5);
    cairo_line_to(menu->cr, x + 6, y - 5);
    cairo_move_to(menu->cr, x - 6, y);
    cairo_line_to(menu->cr, x + 6, y);
    cairo_move_to(menu->cr, x - 6, y + 5);
    cairo_line_to(menu->cr, x + 6, y + 5);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_paste(struct ufsm_machine *m)
{
    L_DEBUG("Action paste");
    ufsm_process(m, eKey_ctrl_down);
    ufsm_process(m, eKey_v_down);
    ufsm_process(m, eKey_ctrl_up);
}

void r_copy(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_BLUE1);

    cairo_rectangle(menu->cr, x - 10, y - 10, 15, 17);
    cairo_rectangle(menu->cr, x - 5, y - 5, 15, 17);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_copy(struct ufsm_machine *m)
{
    L_DEBUG("Action copy");
    ufsm_process(m, eKey_ctrl_down);
    ufsm_process(m, eKey_c_down);
    ufsm_process(m, eKey_ctrl_up);
}

void r_cut(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_BLUE1);

    cairo_arc(menu->cr, x - 10,  y - 10, 4, 0, 2 * M_PI);
    cairo_stroke(menu->cr);
    cairo_arc(menu->cr, x + 10,  y - 10, 4, 0, 2 * M_PI);
    cairo_stroke(menu->cr);
    cairo_move_to(menu->cr, x - 8, y - 8);
    cairo_line_to(menu->cr, x + 10, y + 10);
    cairo_move_to(menu->cr, x + 8, y - 8);
    cairo_line_to(menu->cr, x - 10, y + 10);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_cut(struct ufsm_machine *m)
{
    L_DEBUG("Action cut");
    ufsm_process(m, eKey_ctrl_down);
    ufsm_process(m, eKey_x_down);
    ufsm_process(m, eKey_ctrl_up);
}

void r_save(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_BLUE1);
    cairo_rectangle(menu->cr, x - 10, y - 11, 20, 22);
    cairo_rectangle(menu->cr, x - 5, y - 11, 10, 7);
    cairo_rectangle(menu->cr, x - 6, y + 6, 1, 1);
    cairo_rectangle(menu->cr, x + 6, y + 6, 1, 1);
    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_save(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_s_down);
}

void r_saveas(struct menu *menu, struct menu_item *item)
{
    double x = item->x;
    double y = item->y;
    enum ufsmm_color_theme theme = menu->theme;
    r_background(menu->cr, theme, x, y);

    cairo_save(menu->cr);
    cairo_translate(menu->cr, -2, -2);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 2);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_BLUE1);
    cairo_move_to(menu->cr, x + 10, y - 8);
    cairo_line_to(menu->cr, x + 14, y - 8);
    cairo_move_to(menu->cr, x + 14, y - 8);
    cairo_line_to(menu->cr, x + 14, y + 15);
    cairo_move_to(menu->cr, x + 14, y + 15);
    cairo_line_to(menu->cr, x - 6, y + 15);
    cairo_rectangle(menu->cr, x - 10, y - 11, 20, 22);
    cairo_rectangle(menu->cr, x - 5, y - 11, 10, 7);
    cairo_rectangle(menu->cr, x - 6, y + 6, 1, 1);
    cairo_rectangle(menu->cr, x + 6, y + 6, 1, 1);

    cairo_stroke(menu->cr);
    cairo_restore(menu->cr);
}

void a_saveas(struct ufsm_machine *m)
{
    ufsm_process(m, eKey_S_down);
}

static struct menu_item hmenu[] =
{
    /* Add state */
    {
        .render = r_add_state,
        .action = a_add_state,
    },
    /* Add region */
    {
        .render = r_add_region,
        .action = a_add_region,
    },
    /* Add transition */
    {
        .render = r_add_transition,
        .action = a_add_transition,
    },
    /* Add action */
    {
        .render = r_add_action,
        .action = a_add_action,
    },
    /* Add guard */
    {
        .render = r_add_guard,
        .action = a_add_guard,
    },
    /* Add entry */
    {
        .render = r_add_entry,
        .action = a_add_entry,
    },
    /* Add exit */
    {
        .render = r_add_exit,
        .action = a_add_exit,
    },
    /* Add vertice */
    {
        .render = r_add_vertice,
        .action = a_add_vertice,
    },
    /* Add Fork */
    {
        .render = r_add_fork,
        .action = a_add_fork,
    },
    /* Add Join */
    {
        .render = r_add_join,
        .action = a_add_join,
    },
    /* Add Init */
    {
        .render = r_add_init,
        .action = a_add_init,
    },
    /* Add Final */
    {
        .render = r_add_final,
        .action = a_add_final,
    },
    /* Add Terminate */
    {
        .render = r_add_terminate,
        .action = a_add_terminate,
    },
    /* Add History */
    {
        .render = r_add_history,
        .action = a_add_history,
    },
    /* Add Deep history */
    {
        .render = r_add_deep_history,
        .action = a_add_deep_history,
    },
    /* List terminator */
    {
        .render = NULL,
        .action = NULL
    }
};

static struct menu_item vmenu[] =
{
    /* Delete */
    {
        .render = r_delete,
        .action = a_delete,
    },
    /* Paste */
    {
        .render = r_paste,
        .action = a_paste,
    },
    /* Cut */
    {
        .render = r_cut,
        .action = a_cut,
    },
    /* Copy */
    {
        .render = r_copy,
        .action = a_copy,
    },
    /* Save */
    {
        .render = r_save,
        .action = a_save,
    },
    /* Save as*/
    {
        .render = r_saveas,
        .action = a_saveas,
    },
    /* List terminator */
    {
        .render = NULL,
        .action = NULL
    }
};


struct menu *menu_init(void)
{
    struct menu *new = malloc(sizeof(struct menu));

    if (new == NULL)
        return NULL;

    memset(new, 0, sizeof(*new));
    new->visible = true;

    for (struct menu_item *mitem = hmenu; mitem->render; mitem++) {
        mitem->enabled = true;
    }
    for (struct menu_item *mitem = vmenu; mitem->render; mitem++) {
        mitem->enabled = true;
    }
    return new;
}

void menu_free(struct menu *menu)
{
    free(menu);
}

void menu_render(struct menu *menu,
                 enum ufsmm_color_theme theme,
                 enum ufsmm_selection selection,
                 double width, double height)
{
    menu->width = width;
    menu->height = height;
    menu->theme = theme;
    menu->selection = selection;

    if (!menu->visible)
        return;

    r_background(menu->cr, theme, width - 50, height - 50);

    cairo_save(menu->cr);
    cairo_new_sub_path(menu->cr);
    cairo_set_line_width(menu->cr, 1);
    ufsmm_color_set(menu->cr, theme, UFSMM_COLOR_AQUA1);

    cairo_arc(menu->cr, width - 56,  height - 57, 4, 0, 2 * M_PI);
    cairo_stroke_preserve(menu->cr);
    cairo_fill(menu->cr);
    cairo_arc(menu->cr, width - 56,  height - 45, 4, 0, 2 * M_PI);
    cairo_stroke_preserve(menu->cr);
    cairo_fill(menu->cr);
    cairo_arc(menu->cr, width - 44,  height - 57, 4, 0, 2 * M_PI);
    cairo_stroke_preserve(menu->cr);
    cairo_fill(menu->cr);
    cairo_arc(menu->cr, width - 44,  height - 45, 4, 0, 2 * M_PI);
    cairo_stroke_preserve(menu->cr);
    cairo_fill(menu->cr);
    cairo_restore(menu->cr);

    if (menu->expanded) {
        /* Render horizontal menu */
        double x = width - 100;
        double y = height - 50;

        for (struct menu_item *mitem = hmenu; mitem->render; mitem++) {
            mitem->x = x;
            mitem->y = y;
            mitem->render(menu, mitem);

            x -= 50;
        }
/*
        x = width - 50;
        y = height - 100;

        for (struct menu_item *mitem = vmenu; mitem->render; mitem++) {
            mitem->x = x;
            mitem->y = y;
            mitem->render(menu, mitem);

            y -= 50;
        }*/
    }
}

bool menu_process(struct menu *menu, struct ufsm_machine *m, double px, double py)
{
    if (!menu->visible)
        return false;

    if (point_in_box(px, py, menu->width - 50, menu->height - 50, 40, 40)) {
        if (menu->expanded == true) {
            L_DEBUG("Collapse menu");
            menu->expanded = false;
        } else {
            L_DEBUG("Expand menu");
            menu->expanded = true;
        }

        return true;
    } else if (menu->expanded) {
        /* Check buttons */
        L_DEBUG("Checking...");
        for (struct menu_item *mitem = hmenu; mitem->render; mitem++) {
            if (point_in_box(px, py, mitem->x, mitem->y, 40, 40) && mitem->enabled) {
                mitem->action(m);
                return true;
            }
        }/*
        for (struct menu_item *mitem = vmenu; mitem->render; mitem++) {
            if (point_in_box(px, py, mitem->x, mitem->y, 40, 40) && mitem->enabled) {
                mitem->action(m);
                return true;
            }
        }*/
    }

    return false;
}
