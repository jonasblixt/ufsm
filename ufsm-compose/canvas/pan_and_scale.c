
#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

void canvas_update_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    double dx = priv->px - priv->sx;
    double dy = priv->py - priv->sy;

    priv->ox = priv->tx + dx;
    priv->oy = priv->ty + dy;

    priv->redraw = true;
    printf("%s: %.2f %.2f\n", __func__, priv->ox, priv->oy);
}

void canvas_store_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    printf("%s\n", __func__);
    priv->tx = priv->ox;
    priv->ty = priv->oy;
}

void canvas_inc_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->ox -= priv->px / (priv->scale + 1.0);
    priv->oy -= priv->py / (priv->scale + 1.0);
    priv->scale += 1;
    priv->px = (priv->px * (priv->scale - 1.0)) / priv->scale;
    priv->py = (priv->py * (priv->scale - 1.0)) / priv->scale;
    priv->redraw = true;
    printf("Zi %.2f <ox, oy> = %.2f, %.2f\n", priv->scale, priv->ox, priv->oy);
}

void canvas_dec_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    if (priv->scale <= 1.0)
        return;

    priv->ox += priv->px / (priv->scale - 1.0);
    priv->oy += priv->py / (priv->scale - 1.0);
    priv->scale -= 1.0;
    priv->px = (priv->px * (priv->scale + 1.0)) / priv->scale;
    priv->py = (priv->py * (priv->scale + 1.0)) / priv->scale;
    priv->redraw = true;
    printf("Zo %.2f <ox, oy> = %.2f, %.2f\n", priv->scale, priv->ox, priv->oy);
}
