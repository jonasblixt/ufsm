#include "status.h"
#include "render.h"

static struct uc_status left_status;
static struct uc_status right_status;
static bool g_modified;
static const char *g_last_error;

int uc_status_init(void)
{
    TAILQ_INIT(&left_status);
    TAILQ_INIT(&right_status);
    return 0;
}

void uc_status_free(void)
{
    uc_status_clear();
}

void uc_status_render(struct ufsmm_canvas *canvas, int width, int height)
{
    struct uc_one_status *sts;
    bool first = true;
    int x = 0;
    cairo_text_extents_t extents;
    cairo_t *cr = canvas->cr;

    /* Draw left hand side status */
    TAILQ_FOREACH(sts, &left_status, tailq) {
        cairo_save(cr);
        cairo_set_font_size(cr, 20);
        cairo_text_extents(cr, sts->text, &extents);
        /* Draw background */
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, sts->bg);
        cairo_move_to (cr, x - 10, height - 20);
        cairo_new_sub_path(cr);
        cairo_line_to(cr, x + extents.width + 15, height - 20);
        cairo_line_to(cr, x + extents.width + 20, height - 10);
        cairo_line_to(cr, x + extents.width + 15, height);
        cairo_line_to(cr, x, height);
        if (!first) {
            cairo_line_to(cr, x + 5, height - 10);
        }
        cairo_line_to(cr, x, height - 20);
        cairo_close_path(cr);
        cairo_fill(cr);
        cairo_restore(cr);
        /* Draw end cap */
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG);
        cairo_move_to (cr, x + extents.width + 15, height - 20);
        cairo_line_to(cr, x + extents.width + 20, height - 10);
        cairo_line_to(cr, x + extents.width + 15, height);
        cairo_stroke(cr);
        cairo_restore(cr);
        /* Draw text */
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG);
        cairo_move_to (cr, x + 10, height - 3);
        cairo_show_text (cr, sts->text);
        x += extents.width + 15;
        first = false;
        cairo_restore(cr);
    }

    /* Draw right hand side status */
    first = true;
    x = width;
    TAILQ_FOREACH(sts, &right_status, tailq) {
        cairo_save(cr);
        cairo_set_font_size(cr, 20);
        cairo_text_extents(cr, sts->text, &extents);
        /* Draw background */
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, sts->bg);
        cairo_move_to (cr, x, height - 20);
        cairo_new_sub_path(cr);
        cairo_line_to(cr, x - extents.width - 15, height - 20);
        cairo_line_to(cr, x - extents.width - 20, height - 10);
        cairo_line_to(cr, x - extents.width - 15, height);
        cairo_line_to(cr, x, height);
        if (!first) {
            cairo_line_to(cr, x - 5, height - 10);
        }
        cairo_line_to(cr, x, height - 20);
        cairo_close_path(cr);
        cairo_fill(cr);
        cairo_restore(cr);
        /* Draw end cap */
        cairo_save(cr);
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG);
        cairo_move_to (cr, x - extents.width - 15, height - 20);
        cairo_line_to(cr, x - extents.width - 20, height - 10);
        cairo_line_to(cr, x - extents.width - 15, height);
        cairo_stroke(cr);
        cairo_restore(cr);
        /* Draw text */
        ufsmm_color_set(cr, canvas->theme, UFSMM_COLOR_BG);
        cairo_move_to (cr, x - extents.width - 10, height - 3);
        cairo_show_text (cr, sts->text);
        x -= extents.width + 15;
        first = false;
        cairo_restore(cr);
    }
}

static bool status_pop(struct uc_status *list)
{
    struct uc_one_status *sts = TAILQ_LAST(list, uc_status);

    if (sts != NULL) {
        TAILQ_REMOVE(list, sts, tailq);
        free((void *) sts->text);
        free(sts);
        return true;
    }

    return false;
}

static void status_clear(struct uc_status *list)
{
    while (status_pop(list));
}

void uc_status_clear(void)
{
    status_clear(&left_status);
}

bool uc_status_pop(void)
{
    return status_pop(&left_status);
}

static void status_push(struct uc_status *list, const char *text,
                            enum ufsmm_color bg)
{
    struct uc_one_status *sts = malloc(sizeof(struct uc_one_status));
    memset(sts, 0, sizeof(*sts));
    sts->text = strdup(text);
    sts->bg = bg;
    TAILQ_INSERT_TAIL(list, sts, tailq);
}

void uc_status_push(const char *text)
{
    status_push(&left_status, text, UFSMM_COLOR_AQUA1);
}

void uc_status_push2(const char *text, enum ufsmm_color bg)
{
    status_push(&left_status, text, bg);
}

static void status_insert(const char *text, enum ufsmm_color color)
{
    struct uc_one_status *sts = malloc(sizeof(struct uc_one_status));
    memset(sts, 0, sizeof(*sts));
    sts->text = strdup(text);
    sts->bg = color;
    TAILQ_INSERT_HEAD(&left_status, sts, tailq);
}

void uc_status_insert(const char *text)
{
    status_insert(text, UFSMM_COLOR_AQUA1);
}

void uc_status_insert2(const char *text, enum ufsmm_color color)
{
    status_insert(text, color);
}

static void rstatus_update(void)
{
    status_clear(&right_status);

    if (g_modified) {
        status_push(&right_status, "MODIFIED", UFSMM_COLOR_ORANGE2);
    }

    if (g_last_error) {
        status_push(&right_status, g_last_error, UFSMM_COLOR_RED2);
    }
}

void uc_rstatus_set(bool modified)
{
    g_modified = modified;
    rstatus_update();
}

void uc_rstatus_set_error(const char *error_msg)
{
    g_last_error = error_msg;
    rstatus_update();
}

void uc_status_show_path(struct ufsmm_region *region)
{
    struct ufsmm_region *r = region;


    uc_status_clear();

    if (r == NULL) {
        uc_status_insert2("Root", UFSMM_COLOR_AQUA2);
    }
    while (r) {
        uc_status_insert2(r->name, UFSMM_COLOR_AQUA2);
        if (r->parent_state) {
            uc_status_insert2(r->parent_state->name, UFSMM_COLOR_AQUA1);
            r = r->parent_state->parent_region;
        } else {
            break;
        }
    }

}
