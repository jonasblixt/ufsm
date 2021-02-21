
#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

void canvas_update_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    double dx = priv->px - priv->sx;
    double dy = priv->py - priv->sy;

    priv->current_region->ox = priv->tx + dx;
    priv->current_region->oy = priv->ty + dy;

    priv->redraw = true;
}

void canvas_store_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    printf("%s\n", __func__);
    priv->tx = priv->current_region->ox;
    priv->ty = priv->current_region->oy;
}

void canvas_inc_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->current_region;
    r->ox -= priv->px / (r->scale + 1.0);
    r->oy -= priv->py / (r->scale + 1.0);
    r->scale += 1;
    priv->px = (priv->px * (r->scale - 1.0)) / r->scale;
    priv->py = (priv->py * (r->scale - 1.0)) / r->scale;
    priv->redraw = true;
    printf("Zi %.2f <ox, oy> = %.2f, %.2f\n", r->scale, r->ox, r->oy);
}

void canvas_dec_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    struct ufsmm_region *r = priv->current_region;

    if (r->scale <= 1.0)
        return;

    r->ox += priv->px / (r->scale - 1.0);
    r->oy += priv->py / (r->scale - 1.0);
    r->scale -= 1.0;
    priv->px = (priv->px * (r->scale + 1.0)) / r->scale;
    priv->py = (priv->py * (r->scale + 1.0)) / r->scale;
    priv->redraw = true;
    printf("Zo %.2f <ox, oy> = %.2f, %.2f\n", r->scale, r->ox, r->oy);
}
