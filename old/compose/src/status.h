#ifndef UFSM_COMPOSE_STATUS_H
#define UFSM_COMPOSE_STATUS_H

#include "controller.h"

struct uc_one_status
{
    const char *text;
    enum ufsmm_color bg;
    TAILQ_ENTRY(uc_one_status) tailq;
};

TAILQ_HEAD(uc_status, uc_one_status);

int uc_status_init(void);
void uc_status_free(void);
void uc_status_render(struct ufsmm_canvas *canvas, int width, int height);
void uc_status_clear(void);
bool uc_status_pop(void);
void uc_status_modified(void);
void uc_status_saved(void);
void uc_status_push(const char *text);
void uc_status_push2(const char *text, enum ufsmm_color bg);
void uc_status_insert(const char *text);
void uc_status_insert2(const char *text, enum ufsmm_color bg);
void uc_rstatus_set(bool modified);
void uc_rstatus_set_error(const char *error_msg);
void uc_status_show_path(struct ufsmm_region *region);

#endif
