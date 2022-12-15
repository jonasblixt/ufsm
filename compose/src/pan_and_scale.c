
#include "controller.h"
#include "render.h"
#include "logic/canvas.h"

void canvas_update_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->current_region->ox = priv->current_region->tox + priv->dx;
    priv->current_region->oy = priv->current_region->toy + priv->dy;
    priv->redraw = true;
}

void canvas_store_offset(void *context)
{
    struct ufsmm_canvas *priv = (struct ufsmm_canvas *) context;
    priv->current_region->tox = priv->current_region->ox;
    priv->current_region->toy = priv->current_region->oy;
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
    priv->sx = (priv->sx * (r->scale - 1.0)) / r->scale;
    priv->sy = (priv->sy * (r->scale - 1.0)) / r->scale;
    priv->redraw = true;
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
    priv->sx = (priv->sx * (r->scale + 1.0)) / r->scale;
    priv->sy = (priv->sy * (r->scale + 1.0)) / r->scale;
    priv->redraw = true;
}

