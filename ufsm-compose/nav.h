#ifndef UFSMM_NAV_H
#define UFSMM_NAV_H

#include "controller.h"

void ufsmm_nav_toggle_visibility(struct ufsmm_canvas *canvas);
void ufsmm_nav_render(struct ufsmm_canvas *canvas, int widht, int height);
bool ufsmm_nav_process(struct ufsmm_canvas *canvas, double x, double y);
bool ufsmm_nav_scroll(struct ufsmm_canvas *canvas, double change);

#endif
