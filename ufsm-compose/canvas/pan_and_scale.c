
#include "controller.h"
#include "view.h"
#include "canvas/logic/canvas.h"

void canvas_update_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;

    double dx = priv->px - priv->sx;
    double dy = priv->py - priv->sy;

    dx = dx * priv->scale;
    dy = dy * priv->scale;

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
    priv->scale += 0.1;
    priv->ox += -(priv->px * 0.1);
    priv->oy += -(priv->py * 0.1);
    priv->px *= 1.1;
    priv->py *= 1.1;
    priv->redraw = true;
    printf("Zi %.2f <ox, oy> = %.2f, %.2f\n", priv->scale, priv->ox, priv->oy);
}

void canvas_dec_scale(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->scale -= 0.1;
    priv->ox += (priv->px * 0.1);
    priv->oy += (priv->py * 0.1);
    priv->px *= 0.9;
    priv->py *= 0.9;
    priv->redraw = true;
    printf("Zo %.2f <ox, oy> = %.2f, %.2f\n", priv->scale, priv->ox, priv->oy);
}
