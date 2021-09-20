#ifndef UFSMC_MENU_H
#define UFSMC_MENU_H

#include <cairo/cairo.h>
#include <sys/queue.h>
#include <stdbool.h>
#include <ufsm/ufsm.h>
#include "colors.h"
#include "common.h"

struct ufsmm_canvas;

struct menu {
    double x, y;
    bool visible;
    bool expanded;
    double width, height;
    enum ufsmm_color_theme theme;
    enum ufsmm_selection selection;
    cairo_t *cr;
};

struct menu *menu_init(void);
void menu_free(struct menu *menu);
void menu_render(struct menu *menu,
                 enum ufsmm_color_theme theme,
                 enum ufsmm_selection selection,
                 double width, double height);
bool menu_process(struct menu *menu, struct ufsm_machine *m, double px, double py);

#endif
