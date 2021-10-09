#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ufsm/ufsm.h>
#include "nav.h"
#include "controller.h"
#include "render.h"
#include "utils.h"
#include "logic/canvas.h"


static double scale;

void canvas_nav_show_selected(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
}

void canvas_nav_begin(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->nav_mode = true;
    priv->redraw = true;
}

void canvas_nav_end(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->nav_mode = false;
    priv->redraw = true;
}

static void render_one_page(struct ufsmm_canvas *canvas,
                            struct ufsmm_region *region)
{
    int rc;
    double x, y, w, h;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    static struct ufsmm_stack *stack;
    rc = ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    if (rc != UFSMM_OK)
        return;

    /* Pass 1: draw states, regions etc*/
    rc = ufsmm_stack_push(stack, (void *) region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        ufsmm_canvas_render_region(canvas, r, true);

        if (r->off_page && (r != region))
            continue;
        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_canvas_render_state(canvas, s);

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    /* Pass 2: draw transitions */
    rc = ufsmm_stack_push(stack, (void *) region);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        TAILQ_FOREACH(s, &r->states, tailq) {
            ufsmm_canvas_render_transition(canvas, &s->transitions);
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page)
                    continue;

                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    ufsmm_stack_free(stack);
}

void nav_inc_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    scale += 0.1;
    priv->redraw = true;
}

void nav_dec_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    scale -= 0.1;

    if (scale < 0.1)
        scale = 0.1;
    priv->redraw = true;
}

void canvas_nav_reset_scale(void *context)
{
    scale = 0.2;
}

void ufsmm_nav_render(struct ufsmm_canvas *canvas,
                      int width, int height)
{
    struct ufsmm_stack *stack;
    struct ufsmm_state *s;
    struct ufsmm_region *r, *r2;
    int col_count = 0;
    int row_count = 0;
    int psx, psy;

    ufsmm_paper_size(canvas->model->paper_size, &psx, &psy);

    int n_per_row = (width / (psx * scale));

    L_DEBUG("n_per_row = %i, width = %i", n_per_row, width);
    cairo_t *cr = canvas->cr;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    ufsmm_stack_push(stack, (void *) canvas->model->root);

    ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG0);
    cairo_paint(cr);
    cairo_save(canvas->cr);
    cairo_translate(cr, 10, 10);

    cairo_scale(canvas->cr, scale, scale);


    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        render_one_page(canvas, r);
        cairo_save(cr);
        cairo_set_line_width (cr, 4);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_FG4);
        cairo_rectangle (cr, 0, 0, psx, psy);

        cairo_stroke(cr);
        cairo_restore(cr);
        col_count++;

        if (col_count >= n_per_row) {
            cairo_translate(cr, -(psx + 210)*(n_per_row -1), (psy + 210));
            col_count = 0;
            row_count++;
        } else {
            cairo_translate(cr, (psx + 210), 0);
        }

        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                if (r2->off_page) {
                    ufsmm_stack_push(stack, (void *) r2);
                }
            }
        }
    }

    cairo_restore(cr);
    ufsmm_stack_free(stack);
}
