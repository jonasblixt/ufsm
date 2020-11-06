#include "canvas/view.h"

int ufsmm_canvas_render_grid(cairo_t *cr, int width, int height)
{
    /* clear background */
    //A
    //cairo_set_source_rgb(cr, 1,1,1);

    ufsmm_color_set(cr, UFSMM_COLOR_BG);
    cairo_paint(cr);

    cairo_save(cr);
    /* Draw grid */
    for (int x = 0; x < width/10; x++)
    {
        cairo_move_to (cr, x*10, 0);
        cairo_line_to (cr, x*10, height);
    }

    for (int y = 0; y < height/10; y++)
    {
        cairo_move_to (cr, 0, y*10);
        cairo_line_to (cr, width, y*10);
    }

    //cairo_set_source_rgb (cr, 0.9,0.9,0.9);
    ufsmm_color_set(cr, UFSMM_COLOR_GRID);
    cairo_set_line_width(cr, 1);
    cairo_stroke (cr);

    cairo_restore(cr);
    return 0;
}

double ufsmm_canvas_nearest_grid_point(double in)
{
    return (int)(in / 10) * 10;
}
