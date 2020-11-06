#include "canvas/view.h"

static void hex_to_rgb(uint32_t hex, double *r, double *g, double *b)
{
    (*r) = (double) ((hex >> 24) & 0xff) / 0xff;
    (*g) = (double) ((hex >> 16) & 0xff) / 0xff;
    (*b) = (double) ((hex >> 8) & 0xff) / 0xff;
}

int ufsmm_color_set(cairo_t *cr, enum ufsmm_color color)
{
    double r, g, b;

    switch (color) {
    case UFSMM_COLOR_BG:
        hex_to_rgb(0x28282800, &r, &g, &b);
    break;
    case UFSMM_COLOR_GRID:
        hex_to_rgb(0x1d202100, &r, &g, &b);
    break;
    case UFSMM_COLOR_NORMAL:
        hex_to_rgb(0xa8998400, &r, &g, &b);
    break;
    case UFSMM_COLOR_ACCENT:
        hex_to_rgb(0xd65d0e00, &r, &g, &b);
    break;
    default:
        hex_to_rgb(0x4a708e00, &r, &g, &b);
    }

    cairo_set_source_rgb (cr, r, g, b);
}
