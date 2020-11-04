/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ufsm.h>

#include <sotc/sotc.h>
#include <sotc/model.h>
#include <sotc/stack.h>

#include "output.h"

#ifdef __NOPE
struct event_list
{
    char *name;
    uint32_t index;
    struct event_list *next;
};

static struct event_list *evlist;

static struct ufsm_entry_exit *eelist_first;
static struct ufsm_entry_exit **eelist = &eelist_first;
static struct ufsm_guard *guard_first;
static struct ufsm_guard **guard_list = &guard_first;
static struct ufsm_action *action_first;
static struct ufsm_action **action_list = &action_first;

static char * id_to_decl(const char *id)
{
    char * decl = malloc (strlen(id)+1);
    char * decl_ptr = decl;
    bzero(decl, strlen(id) + 1);

    do
    {
        *decl_ptr = *id++;
        if (*decl_ptr == '+')
            *decl_ptr = '_';
        if (*decl_ptr == '/')
            *decl_ptr = '_';
        if (*decl_ptr == '=')
            *decl_ptr = 0;

    } while (*decl_ptr++);

    return decl;
}

static uint32_t ev_name_to_index(const char *name)
{
    struct event_list *last_entry = evlist;

    if (evlist == NULL)
    {
        evlist = malloc(sizeof(struct event_list));
        bzero(evlist, sizeof(struct event_list));
        evlist->name = malloc(strlen(name)+1);
        strcpy(evlist->name, name);
        evlist->index = 0;
        evlist->next = NULL;
        return 0;
    }

    for (struct event_list *e = evlist; e; e = e->next) {
        if (strcmp(name, e->name) == 0) {
            return e->index;
        }
        last_entry = e;
    }

    last_entry->next = malloc(sizeof(struct event_list));
    bzero(last_entry->next, sizeof(struct event_list));
    struct event_list *e = last_entry->next;
    e->name = malloc(strlen(name)+1);
    strcpy(e->name, name);
    e->index = last_entry->index+1;
    return e->index;
}

static void ufsm_gen_regions(struct ufsm_region *region);

static void ufsm_gen_states(struct ufsm_state *state)
{
    fprintf(fp_c,"static struct ufsm_state %s = {\n",id_to_decl(state->id));

    if (flag_strip) {
         fprintf (fp_c,"  .id     = \"\", \n");
         fprintf (fp_c,"  .name   = \"\", \n");
    } else {
        fprintf(fp_c,"  .id   = \"%s\",\n",state->id);
        fprintf(fp_c,"  .name = \"%s\",\n",state->name);
    }
    fprintf(fp_c,"  .kind = %i,\n",state->kind);
    fprintf(fp_c,"  .parent_region = &%s,\n",
                            id_to_decl(state->parent_region->id));
    if (state->entry)
        fprintf(fp_c,"  .entry = &%s,\n",id_to_decl(state->entry->id));
    else
        fprintf(fp_c,"  .entry = NULL,\n");

    if (state->exit)
        fprintf(fp_c,"  .exit = &%s,\n",id_to_decl(state->exit->id));
    else
        fprintf(fp_c,"  .exit = NULL,\n");

    if (state->region) {
        fprintf(fp_c,"  .region = &%s,\n",id_to_decl(state->region->id));
    } else {
        fprintf(fp_c,"  .region = NULL,\n");
    }

    if (state->next)
        fprintf(fp_c,"  .next = &%s,\n",id_to_decl(state->next->id));
    else
        fprintf(fp_c,"  .next = NULL,\n");

    fprintf(fp_c,"};\n");
    if (state->region)
        ufsm_gen_regions(state->region);

    for (struct ufsm_entry_exit *e = state->entry; e; e = e->next) {
        fprintf(fp_c, "static struct ufsm_entry_exit %s = {\n",
                        id_to_decl(e->id));
        if (flag_strip) {
             fprintf (fp_c,"  .id     = \"\", \n");
             fprintf (fp_c,"  .name   = \"\", \n");
        } else {
            fprintf(fp_c, "  .id = \"%s\",\n", e->id);
            fprintf(fp_c, "  .name = \"%s\",\n",e->name);
        }
        fprintf(fp_c, "  .f = &%s,\n", e->name);
        if (e->next)
            fprintf (fp_c, "  .next = &%s,\n", id_to_decl(e->next->id));
        else
            fprintf (fp_c, "  .next = NULL,\n");

        fprintf(fp_c, "};\n");

        bool found_duplicate = false;

        for (struct ufsm_entry_exit *ee = eelist_first; ee; ee = ee->next)
        {
            if (strcmp(ee->name,e->name) == 0)
            {
                found_duplicate = true;
                break;
            }
        }

        if (!found_duplicate)
        {
            (*eelist) = malloc(sizeof(struct ufsm_entry_exit));
            memcpy ((*eelist), e, sizeof(struct ufsm_entry_exit));
            eelist = &(*eelist)->next;
        }


    }

    for (struct ufsm_entry_exit *e = state->exit; e; e = e->next) {
        fprintf(fp_c, "static struct ufsm_entry_exit %s = {\n",
                        id_to_decl(e->id));
        if (flag_strip) {
             fprintf (fp_c,"  .id     = \"\", \n");
             fprintf (fp_c,"  .name   = \"\", \n");
        } else {
            fprintf(fp_c, "  .id = \"%s\",\n", e->id);
            fprintf(fp_c, "  .name = \"%s\",\n",e->name);
        }

        fprintf(fp_c, "  .f = &%s,\n", e->name);
        if (e->next)
            fprintf (fp_c, "  .next = &%s,\n", id_to_decl(e->next->id));
        else
            fprintf (fp_c, "  .next = NULL,\n");


        fprintf(fp_c, "};\n");

        bool found_duplicate = false;

        for (struct ufsm_entry_exit *ee = eelist_first; ee; ee = ee->next)
        {
            if (strcmp(ee->name,e->name) == 0)
            {
                found_duplicate = true;
                break;
            }
        }

        if (!found_duplicate)
        {
            (*eelist) = malloc(sizeof(struct ufsm_entry_exit));
            memcpy ((*eelist), e, sizeof(struct ufsm_entry_exit));
            eelist = &(*eelist)->next;
        }
    }
}

static void ufsm_gen_regions(struct ufsm_region *region)
{
    for (struct ufsm_region *r = region; r; r = r->next) {
        fprintf (fp_c,"static struct ufsm_region %s = {\n",id_to_decl(r->id));
        if (flag_strip) {
             fprintf (fp_c,"  .id     = \"\", \n");
             fprintf (fp_c,"  .name   = \"\", \n");
        } else {
            fprintf (fp_c,"  .id = \"%s\",\n", r->id);
            fprintf (fp_c,"  .name = \"%s\",\n", r->name);
        }
        if (r->state)
            fprintf (fp_c,"  .state = &%s,\n", id_to_decl(r->state->id));
        else
            fprintf (fp_c,"  .state = NULL,\n");

        fprintf (fp_c,"  .has_history = %s,\n", r->has_history ? "true" : "false");
        fprintf (fp_c,"  .history = NULL,\n");
        if (r->transition)
            fprintf (fp_c,"  .transition = &%s,\n",
                                            id_to_decl(r->transition->id));
        else
            fprintf (fp_c,"  .transition = NULL,\n");

        if (r->parent_state)
            fprintf (fp_c,"  .parent_state = &%s,\n",
                                id_to_decl(r->parent_state->id));
        else
            fprintf (fp_c,"  .parent_state = NULL,\n");
        if (r->next)
            fprintf (fp_c,"  .next = &%s,\n",id_to_decl(r->next->id));
        else
            fprintf (fp_c,"  .next = NULL,\n");
        fprintf (fp_c,"};\n");

        for (struct ufsm_transition *t = r->transition; t; t = t->next) {

            if (t->trigger)
            {
                fprintf(fp_c, "static struct ufsm_trigger %s_triggers[] = {\n",
                            id_to_decl(t->id));

                struct ufsm_trigger *tt = t->trigger;

                fprintf(fp_c, "{\n");
                fprintf(fp_c, "  .trigger = %i,\n",
                            ev_name_to_index(tt->name));
                fprintf(fp_c, "  .name = \"%s\",\n", tt->name);
                fprintf(fp_c, "},\n");
                fprintf(fp_c, " {\n");
                fprintf(fp_c, "  .trigger = -1,\n");
                fprintf(fp_c, "  .name = NULL,\n");
                fprintf(fp_c, "},\n");
                fprintf(fp_c,"};\n");
            }

            fprintf(fp_c, "static struct ufsm_transition %s = {\n",
                               id_to_decl(t->id));
            if (flag_strip) {
                 fprintf (fp_c,"  .id     = \"\", \n");
                 fprintf (fp_c,"  .name   = \"\", \n");
            } else {
                fprintf(fp_c, "  .id = \"%s\",\n", t->id);
                fprintf(fp_c, "  .name = \"\",\n");
            }

            if (t->trigger != NULL)
            {
                fprintf(fp_c, "  .trigger = %s_triggers,\n",
                                id_to_decl(t->id));
            }
            else
            {
                fprintf(fp_c, "  .trigger = NULL,\n");
            }

            fprintf(fp_c, "  .kind = %i,\n",t->kind);
            if (t->action) {
                fprintf(fp_c, "  .action = &%s,\n", id_to_decl(t->action->id));

                bool found_duplicate = false;

                for (struct ufsm_action *aa = action_first; aa; aa = aa->next)
                {
                    if (strcmp(aa->name,t->action->name) == 0)
                    {
                        found_duplicate = true;
                        break;
                    }
                }

                if (!found_duplicate)
                {
                    (*action_list) = malloc(sizeof(struct ufsm_action));
                    memcpy ((*action_list), t->action, sizeof(struct ufsm_action));
                    action_list = &(*action_list)->next;
                }

            } else {
                fprintf(fp_c, "  .action = NULL,\n");
            }
            if (t->guard)
            {
                fprintf(fp_c, "  .guard = &%s,\n", id_to_decl(t->guard->id));

                bool found_duplicate = false;

                for (struct ufsm_guard *gg = guard_first; gg; gg = gg->next)
                {
                    if (strcmp(gg->id,t->guard->id) == 0)
                    {
                        found_duplicate = true;
                        break;
                    }
                }

                if (!found_duplicate)
                {
                    (*guard_list) = malloc(sizeof(struct ufsm_guard));
                    memcpy ((*guard_list), t->guard, sizeof(struct ufsm_guard));
                    guard_list = &(*guard_list)->next;
                }
            }
            else
            {
                fprintf(fp_c, "  .guard = NULL,\n");
            }

            fprintf(fp_c, "  .source = &%s,\n",id_to_decl(t->source->id));
            fprintf(fp_c, "  .dest = &%s,\n",id_to_decl(t->dest->id));
            if (t->next)
                fprintf(fp_c, "  .next = &%s,\n",id_to_decl(t->next->id));
            else
               fprintf(fp_c, "  .next = NULL,\n");
            fprintf(fp_c, "};\n");
            for (struct ufsm_action *a = t->action; a; a = a->next) {
                fprintf(fp_c, "static struct ufsm_action %s = {\n",
                            id_to_decl(a->id));
                if (flag_strip) {
                     fprintf (fp_c,"  .id     = \"\", \n");
                     fprintf (fp_c,"  .name   = \"\", \n");
                } else {
                    fprintf(fp_c, "  .id = \"%s\",\n", a->id);
                    fprintf(fp_c, "  .name = \"%s\",\n", a->name);
                }
                fprintf(fp_c, "  .f = &%s,\n", a->name);
                if (a->next)
                    fprintf(fp_c, "  .next = &%s,\n", id_to_decl(a->next->id));
                else
                    fprintf(fp_c, "  .next = NULL,\n");
                fprintf(fp_c, "};\n");
            }
            for (struct ufsm_guard *g = t->guard; g; g = g->next) {
                fprintf(fp_c, "static struct ufsm_guard %s = {\n",
                            id_to_decl(g->id));
                fprintf(fp_c, "  .id = \"%s\",\n", g->id);
                fprintf(fp_c, "  .name = \"%s\",\n", g->name);
                fprintf(fp_c, "  .f = &%s,\n", g->name);
                if (g->next)
                    fprintf(fp_c, "  .next = &%s,\n", id_to_decl(g->next->id));
                else
                    fprintf(fp_c, "  .next = NULL,\n");

                fprintf(fp_c, "};\n");
            }
        }
        for (struct ufsm_state *s = r->state; s; s = s->next)
            ufsm_gen_states(s);
    }
}

bool ufsm_gen_machine (struct ufsm_machine *m)
{
    fprintf (fp_c,"static struct ufsm_machine %s = {\n",id_to_decl(m->id));
    if (flag_strip) {
         fprintf (fp_c,"  .id     = \"\", \n");
         fprintf (fp_c,"  .name   = \"\", \n");
    } else {
        fprintf (fp_c,"  .id     = \"%s\", \n", m->id);
        fprintf (fp_c,"  .name   = \"%s\", \n", m->name);
    }
    fprintf (fp_c,"  .region = &%s,    \n",id_to_decl(m->region->id));
    if (m->next)
        fprintf (fp_c,"  .next = &%s, \n", id_to_decl(m->next->id));
    else
        fprintf (fp_c,"  .next = NULL,\n");


    if (m->parent_state)
        fprintf (fp_c,"  .parent_state = &%s, \n", id_to_decl(m->parent_state->id));
    else
        fprintf (fp_c,"  .parent_state = NULL, \n");

    fprintf (fp_c,"};\n");

    if (m->region)
        ufsm_gen_regions(m->region);
    return true;
}



static void ufsm_gen_regions_decl(struct ufsm_region *region);

static void ufsm_gen_states_decl(struct ufsm_state *state)
{
    fprintf(fp_c,"static struct ufsm_state %s;\n",id_to_decl(state->id));
    if (state->region)
        ufsm_gen_regions_decl(state->region);



    for (struct ufsm_entry_exit *e = state->entry; e; e = e->next)
        fprintf(fp_c, "static struct ufsm_entry_exit %s;\n",
                        id_to_decl(e->id));

    for (struct ufsm_entry_exit *e = state->exit; e; e = e->next)
        fprintf(fp_c, "static struct ufsm_entry_exit %s;\n",
                        id_to_decl(e->id));


}

static void ufsm_gen_regions_decl(struct ufsm_region *region)
{
    for (struct ufsm_region *r = region; r; r = r->next) {
        fprintf (fp_c,"static struct ufsm_region %s;\n",id_to_decl(r->id));

        for (struct ufsm_transition *t = r->transition; t; t = t->next) {
            fprintf(fp_c, "static struct ufsm_transition %s;\n",
                               id_to_decl(t->id));

            for (struct ufsm_action *a = t->action; a; a = a->next)
            {
                fprintf(fp_c, "static struct ufsm_action %s;\n",
                        id_to_decl(a->id));
            }

            for (struct ufsm_guard *g = t->guard; g; g = g->next)
                fprintf(fp_c, "static struct ufsm_guard %s;\n",
                            id_to_decl(g->id));

        }

        for (struct ufsm_state *s = r->state; s; s = s->next)
            ufsm_gen_states_decl(s);

    }
}

bool ufsm_gen_machine_decl (struct ufsm_machine *m)
{
    fprintf (fp_c,"static struct ufsm_machine %s;\n",id_to_decl(m->id));
    ufsm_gen_regions_decl(m->region);
    return true;
}

#endif

static void uu_to_str(uuid_t uu, char *output)
{
    uuid_unparse(uu, output);

    for (int n = 0; n < 37; n++) {
        if (output[n] == '-')
            output[n] = '_';
    }
}

static int generate_c_file(struct sotc_model *model,
                                const char *filename, FILE *fp)
{
    int rc = 0;
    struct sotc_region *r, *r2;
    struct sotc_state *s;
    static struct sotc_stack *stack;
    char uu_str[37];

    fprintf(fp, "#include \"%s.h\"\n\n", filename);

    rc = sotc_stack_init(&stack, SOTC_MAX_R_S);

    if (rc != SOTC_OK)
        return rc;

    /* Pass 1: Forward declare states and regions */
    rc = sotc_stack_push(stack, (void *) model->root);

    fprintf(fp, "/* Forward declaration of states and regions */\n");
    while (sotc_stack_pop(stack, (void *) &r) == SOTC_OK)
    {
        uu_to_str(r->id, uu_str);
        fprintf(fp, "const struct r_%s; /* Region: %s */\n", uu_str, r->name);
        for (s = r->state; s; s = s->next)
        {
            uu_to_str(s->id, uu_str);
            fprintf(fp, "const struct s_%s; /* State: %s */\n", uu_str, s->name);
            for (r2 = s->regions; r2; r2 = r2->next)
            {
                sotc_stack_push(stack, (void *) r2);
            }
        }
    }

    /* Triggers */
    fprintf(fp, "\n/* Triggers */\n");

    for (struct sotc_trigger *t = model->triggers; t; t = t->next) {
        uu_to_str(t->id, uu_str);
        fprintf(fp, "const struct ufsm_trigger trigger_%s = {\n", uu_str);
        fprintf(fp, "    .name = \"%s\",\n", t->name);
        fprintf(fp, "    .trigger = %s,\n", t->name);
        fprintf(fp, "};\n\n");
    }

    sotc_stack_free(stack);
    return rc;
}
static int generate_header_file(struct sotc_model *model,
                                const char *filename, FILE *fp)
{
    fprintf(fp, "#ifndef UFSM_MACHINE_%s_H_\n", filename);
    fprintf(fp, "#define UFSM_MACHINE_%s_H_\n\n", filename);
    fprintf(fp, "#include <stdint.h>\n");
    fprintf(fp, "#include <stddef.h>\n");
    fprintf(fp, "#include <stdbool.h>\n");
    fprintf(fp, "#include <ufsm.h>\n\n");

    /* Triggers */
    if (model->triggers) {
        fprintf(fp, "/* Triggers */\n");
        fprintf(fp, "enum {\n");

        for (struct sotc_trigger *t = model->triggers; t; t = t->next) {
            fprintf(fp, "    %s,\n", t->name);
        }

        fprintf(fp, "};\n\n");
    }

    /* Entry action function prototypes */
    if (model->entries) {
        fprintf(fp, "/* Entry action function prototypes */\n");

        for (struct sotc_action *a = model->entries; a; a = a->next) {
            fprintf(fp, "void %s(void);\n", a->name);
        }

        fprintf(fp, "\n");
    }

    /* Exit action function prototypes */
    if (model->exits) {
        fprintf(fp, "/* Exit action function prototypes */\n");

        for (struct sotc_action *a = model->exits; a; a = a->next) {
            fprintf(fp, "void %s(void);\n", a->name);
        }

        fprintf(fp, "\n");
    }

    /* Guard function prototypes */
    if (model->guards) {
        fprintf(fp, "/* Guard function prototypes */\n");

        for (struct sotc_action *a = model->guards; a; a = a->next) {
            fprintf(fp, "bool %s(void);\n", a->name);
        }

        fprintf(fp, "\n");
    }

    /* Action function prototypes */
    if (model->actions) {
        fprintf(fp, "/* Action function prototypes */\n");

        for (struct sotc_action *a = model->actions; a; a = a->next) {
            fprintf(fp, "void %s(void);\n", a->name);
        }

        fprintf(fp, "\n");
    }

    /* TODO: Machine initializer macro */

    fprintf(fp, "#endif  // UFSM_MACHINE_%s_H_\n", filename);
    return 0;
}

static void generate_file_header(FILE *fp)
{
    fprintf(fp, "/* Automatically generated by uFSM version x.y.z */\n\n");
}

int ufsm_gen_output(struct sotc_model *model, const char *output_filename,
                     const char *output_path,
                     int verbose, int strip_level)
{
    int rc = 0;
    FILE *fp_c = NULL;
    FILE *fp_h = NULL;

    /* Open file handles for 'output_filename'.[ch] */
    size_t output_filename_len = strlen(output_path) + 3;
    char *fn_str = malloc(output_filename_len);
    sprintf(fn_str, "%s.c", output_path);

    fp_c = fopen(fn_str, "w");

    if (fp_c == NULL) {
        fprintf(stderr, "Error: Could not open file '%s' for writing\n", fn_str);
        free(fn_str);
        return -1;
    }

    sprintf(fn_str, "%s.h", output_path);
    fp_h = fopen(fn_str, "w");

    if (fp_h == NULL) {
        fprintf(stderr, "Error: Could not open file '%s' for writing\n", fn_str);
        fclose(fp_c);
        free(fn_str);
        return -1;
    }

    free(fn_str);

    /* Generate headers for c and h files */
    generate_file_header(fp_h);
    generate_file_header(fp_c);

    rc = generate_header_file(model, output_filename, fp_h);

    if (rc != 0) {
        fprintf(stderr, "Error: Could not generate header file '%s.h'\n",
                                output_filename);
        goto err_close_fps_out;
    }

    rc = generate_c_file(model, output_filename, fp_c);

    if (rc != 0) {
        fprintf(stderr, "Error: Could not generate header file '%s.h'\n",
                                output_filename);
        goto err_close_fps_out;
    }

err_close_fps_out:
    fclose(fp_c);
    fclose(fp_h);

    return rc;
}
