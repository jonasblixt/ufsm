/**
 * uFSM
 *
 * Copyright (C) 2020 Jonas Blixt <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <stdio.h>
#include <unistd.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ufsm/ufsm.h>
#include <ufsm/model.h>

#include "output.h"

static int state_counter;
static int region_counter;

static void uu_to_str(uuid_t uu, char *output)
{
    uuid_unparse(uu, output);

    for (int n = 0; n < 37; n++) {
        if (output[n] == '-')
            output[n] = '_';
    }
}

static void generate_transitions(FILE *fp, struct ufsmm_state *s)
{
    char uu_str[37];
    struct ufsmm_transition *t;

    if (s->transitions.tqh_first) {
        fprintf(fp, "/* Transitions originating from '%s' */\n", s->name);
    }

    /* Forward declare transitions */

    TAILQ_FOREACH(t, &s->transitions, tailq) {
        uu_to_str(t->id, uu_str);
        fprintf(fp, "const struct ufsm_transition t_%s;\n", uu_str);
        for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next) {
            uu_to_str(ar->id, uu_str);
            fprintf(fp, "const struct ufsm_action a_%s;\n", uu_str);
        }
        for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next) {
            uu_to_str(ar->id, uu_str);
            fprintf(fp, "const struct ufsm_guard g_%s;\n", uu_str);
        }
    }

    fprintf(fp, "\n");

    TAILQ_FOREACH(t, &s->transitions, tailq) {
        for (struct ufsmm_action_ref *ar = t->action; ar; ar = ar->next) {
            uu_to_str(ar->id, uu_str);
            fprintf(fp, "const struct ufsm_action a_%s = {\n", uu_str);
            fprintf(fp, "    .name = \"%s\",\n", ar->act->name);
            fprintf(fp, "    .f = &%s,\n", ar->act->name);
            if (ar->next) {
                uu_to_str(ar->next->id, uu_str);
                fprintf(fp, "    .next = &a_%s,\n", uu_str);
            } else {
                fprintf(fp, "    .next = NULL,\n");
            }
            fprintf(fp, "};\n\n");
        }

        for (struct ufsmm_action_ref *ar = t->guard; ar; ar = ar->next) {
            uu_to_str(ar->id, uu_str);
            fprintf(fp, "const struct ufsm_guard g_%s = {\n", uu_str);
            fprintf(fp, "    .name = \"%s\",\n", ar->act->name);
            fprintf(fp, "    .f = &%s,\n", ar->act->name);
            if (ar->next) {
                uu_to_str(ar->next->id, uu_str);
                fprintf(fp, "    .next = &g_%s,\n", uu_str);
            } else {
                fprintf(fp, "    .next = NULL,\n");
            }
            fprintf(fp, "};\n\n");
        }

        uu_to_str(t->id, uu_str);
        fprintf(fp, "const struct ufsm_transition t_%s = {\n", uu_str);
        fprintf(fp, "    .kind = UFSM_TRANSITION_EXTERNAL,\n");

        if (t->trigger) {
            uu_to_str(t->trigger->id, uu_str);
            fprintf(fp, "    .trigger = &trigger_%s,\n", uu_str);
        } else {
            fprintf(fp, "    .trigger = NULL,\n");
        }

        if (t->action) {
            uu_to_str(t->action->id, uu_str);
            fprintf(fp, "    .action = &a_%s,\n", uu_str);
        } else {
            fprintf(fp, "    .action = NULL,\n");
        }

        if (t->guard) {
            uu_to_str(t->guard->id, uu_str);
            fprintf(fp, "    .guard = &g_%s,\n", uu_str);
        } else {
            fprintf(fp, "    .guard = NULL,\n");
        }

        uu_to_str(t->source.state->id, uu_str);
        fprintf(fp, "    .source = &s_%s,\n", uu_str);
        uu_to_str(t->dest.state->id, uu_str);
        fprintf(fp, "    .dest = &s_%s,\n", uu_str);
        if (TAILQ_NEXT(t, tailq)) {
            uu_to_str(TAILQ_NEXT(t, tailq)->id, uu_str);
            fprintf(fp, "    .next = &t_%s,\n", uu_str);
        } else {
            fprintf(fp, "    .next = NULL,\n");
        }

        fprintf(fp, "};\n\n");
    }
}

static void generate_entry_and_exits(FILE *fp, struct ufsmm_state *s)
{
    char uu_str[37];

    if (s->entries) {
        fprintf(fp, "/* Entry functions for state '%s' */\n", s->name);
    }

    for (struct ufsmm_action_ref *ar = s->entries; ar; ar = ar->next) {
        uu_to_str(ar->id, uu_str);
        fprintf(fp, "const struct ufsm_entry_exit entry_%s;\n", uu_str);
    }

    for (struct ufsmm_action_ref *ar = s->entries; ar; ar = ar->next) {
        uu_to_str(ar->id, uu_str);
        fprintf(fp, "const struct ufsm_entry_exit entry_%s = {\n", uu_str);
        fprintf(fp, "    .name = \"%s\",\n", ar->act->name);
        fprintf(fp, "    .f = &%s,\n", ar->act->name);
        if (ar->next) {
            uu_to_str(ar->next->id, uu_str);
            fprintf(fp, "    .next = &entry_%s,\n", uu_str);
        } else {
            fprintf(fp, "    .next = NULL,\n");
        }
        fprintf(fp, "};\n\n");
    }

    if (s->exits) {
        fprintf(fp, "/* Exit functions for state '%s' */\n", s->name);
    }

    for (struct ufsmm_action_ref *ar = s->exits; ar; ar = ar->next) {
        uu_to_str(ar->id, uu_str);
        fprintf(fp, "const struct ufsm_entry_exit exit_%s;\n", uu_str);
    }

    for (struct ufsmm_action_ref *ar = s->exits; ar; ar = ar->next) {
        uu_to_str(ar->id, uu_str);
        fprintf(fp, "const struct ufsm_entry_exit exit_%s = {\n", uu_str);
        fprintf(fp, "    .name = \"%s\",\n", ar->act->name);
        fprintf(fp, "    .f = &%s,\n", ar->act->name);
        if (ar->next) {
            uu_to_str(ar->next->id, uu_str);
            fprintf(fp, "    .next = &exit_%s,\n", uu_str);
        } else {
            fprintf(fp, "    .next = NULL,\n");
        }
        fprintf(fp, "};\n\n");
    }
}

static void generate_state_output(FILE *fp, struct ufsmm_state *s)
{
    char uu_str[37];

    generate_entry_and_exits(fp, s);
    generate_transitions(fp, s);

    uu_to_str(s->id, uu_str);
    fprintf(fp, "const struct ufsm_state s_%s = {\n", uu_str);
    fprintf(fp, "    .index = %i,\n", state_counter++);
    fprintf(fp, "    .name = \"%s\",\n", s->name);
    const char *state_kind = "";

    switch (s->kind) {
        case UFSMM_STATE_NORMAL:
            state_kind = "UFSM_STATE_SIMPLE";
        break;
        case UFSMM_STATE_INIT:
            state_kind = "UFSM_STATE_INIT";
        break;
        case UFSMM_STATE_FINAL:
            state_kind = "UFSM_STATE_FINAL";
        break;
        case UFSMM_STATE_SHALLOW_HISTORY:
            state_kind = "UFSM_STATE_SHALLOW_HISTORY";
        break;
        case UFSMM_STATE_DEEP_HISTORY:
            state_kind = "UFSM_STATE_DEEP_HISTORY";
        break;
        case UFSMM_STATE_EXIT_POINT:
            state_kind = "UFSM_STATE_EXIT_POINT";
        break;
        case UFSMM_STATE_ENTRY_POINT:
            state_kind = "UFSM_STATE_ENTRY_POINT";
        break;
        case UFSMM_STATE_JOIN:
            state_kind = "UFSM_STATE_JOIN";
        break;
        case UFSMM_STATE_FORK:
            state_kind = "UFSM_STATE_FORK";
        break;
        case UFSMM_STATE_CHOICE:
            state_kind = "UFSM_STATE_CHOICE";
        break;
        case UFSMM_STATE_JUNCTION:
            state_kind = "UFSM_STATE_JUNCTION";
        break;
        case UFSMM_STATE_TERMINATE:
            state_kind = "UFSM_STATE_TERMINATE";
        break;
        default:
        break;
    }
    fprintf(fp, "    .kind = %s,\n", state_kind);

    if (s->transitions.tqh_first) {
        uu_to_str(s->transitions.tqh_first->id, uu_str);
        fprintf(fp, "    .transition = &t_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .transition = NULL,\n");
    }

    if (s->entries) {
        uu_to_str(s->entries->id, uu_str);
        fprintf(fp, "    .entry = &entry_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .entry = NULL,\n");
    }

    if (s->exits) {
        uu_to_str(s->exits->id, uu_str);
        fprintf(fp, "    .exit = &exit_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .exit = NULL,\n");
    }

    if (s->regions) {
        uu_to_str(s->regions->id, uu_str);
        fprintf(fp, "    .region = &r_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .region = NULL,\n");
    }

    uu_to_str(s->parent_region->id, uu_str);
    fprintf(fp, "    .parent_region = &r_%s,\n", uu_str);

    if (s->next) {
        uu_to_str(s->next->id, uu_str);
        fprintf(fp, "    .next = &s_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .next = NULL,\n");
    }
    fprintf(fp, "};\n\n");
}

static void generate_region_output(FILE *fp, struct ufsmm_region *r)
{
    char uu_str[37];
    bool region_has_history = false;

    for (struct ufsmm_state *s = r->state; s; s = s->next) {
        if ((s->kind == UFSMM_STATE_SHALLOW_HISTORY) ||
            (s->kind == UFSMM_STATE_DEEP_HISTORY)) {
            region_has_history = true;
            break;
        }
    }

    if(!region_has_history && r->parent_state) {
        struct ufsmm_region *rr = r->parent_state->parent_region;

        while (rr) {
            for (struct ufsmm_state *s = rr->state; s; s = s->next) {
                if ((s->kind == UFSMM_STATE_SHALLOW_HISTORY) ||
                    (s->kind == UFSMM_STATE_DEEP_HISTORY)) {
                    region_has_history = true;
                    break;
                }
            }

            if (rr->parent_state)
                rr = rr->parent_state->parent_region;
            else
                break;
        }

    }

    uu_to_str(r->id, uu_str);
    fprintf(fp, "const struct ufsm_region r_%s = {\n", uu_str);
    fprintf(fp, "    .index = %i,\n", region_counter++);
    fprintf(fp, "    .name = \"%s\",\n", r->name);
    if (region_has_history)
        fprintf(fp, "    .has_history = true,\n");
    else
        fprintf(fp, "    .has_history = false,\n");

    if (r->state) {
        uu_to_str(r->state->id, uu_str);
        fprintf(fp, "    .state = &s_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .state = NULL,\n");
    }

    if (r->parent_state) {
        uu_to_str(r->parent_state->id, uu_str);
        fprintf(fp, "    .parent_state = &s_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .parent_state = NULL,\n");
    }

    if (r->next) {
        uu_to_str(r->next->id, uu_str);
        fprintf(fp, "    .next = &r_%s,\n", uu_str);
    } else {
        fprintf(fp, "    .next = NULL,\n");
    }
    fprintf(fp, "};\n\n");
}

static char* replace_char(char* str, char find, char replace)
{
    char *current_pos = strchr(str, find);

    while (current_pos) {
        *current_pos = replace;
        current_pos = strchr(current_pos, find);
    }

    return str;
}

static void sanitize_machine_name(char *name)
{
    for (int i = 0; name[i]; i++)
        name[i] = tolower(name[i]);

    replace_char(name, '-', '_');
    replace_char(name, ' ', '_');
    replace_char(name, '.', '_');
}

static int generate_c_file(struct ufsmm_model *model,
                                const char *filename,
                                unsigned int stack_elements,
                                unsigned int stack2_elements,
                                FILE *fp)
{
    int rc = 0;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    static struct ufsmm_stack *stack;
    char uu_str[37];

    fprintf(fp, "#include \"%s.h\"\n\n", filename);

    rc = ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    if (rc != UFSMM_OK)
        return rc;

    /* Pass 1: Forward declare states and regions */
    rc = ufsmm_stack_push(stack, (void *) model->root);

    fprintf(fp, "/* Forward declaration of states and regions */\n");
    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        uu_to_str(r->id, uu_str);
        fprintf(fp, "const struct ufsm_region r_%s; /* Region: %s */\n", uu_str, r->name);
        for (s = r->state; s; s = s->next)
        {
            uu_to_str(s->id, uu_str);
            fprintf(fp, "const struct ufsm_state s_%s; /* State: %s */\n", uu_str, s->name);
            for (r2 = s->regions; r2; r2 = r2->next)
            {
                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    /* Pass 2: Triggers */
    fprintf(fp, "\n/* Triggers */\n");

    for (struct ufsmm_trigger *t = model->triggers; t; t = t->next) {
        uu_to_str(t->id, uu_str);
        fprintf(fp, "const struct ufsm_trigger trigger_%s = {\n", uu_str);
        fprintf(fp, "    .name = \"%s\",\n", t->name);
        fprintf(fp, "    .trigger = %s,\n", t->name);
        fprintf(fp, "};\n\n");
    }

    /* Pass 3: The reset */
    rc = ufsmm_stack_push(stack, (void *) model->root);

    while (ufsmm_stack_pop(stack, (void *) &r) == UFSMM_OK)
    {
        generate_region_output(fp, r);

        for (s = r->state; s; s = s->next)
        {
            generate_state_output(fp, s);

            for (r2 = s->regions; r2; r2 = r2->next)
            {
                ufsmm_stack_push(stack, (void *) r2);
            }
        }
    }

    ufsmm_stack_free(stack);

    char *sane_machine_name = malloc(strlen(model->name) + 1);
    strcpy(sane_machine_name, model->name);

    sanitize_machine_name(sane_machine_name);


    fprintf(fp, "/* Machine API */\n");
    fprintf(fp, "int %s_machine_initialize(struct %s_machine *machine, void *ctx)\n",
                    sane_machine_name, sane_machine_name);
    fprintf(fp, "{\n");
    fprintf(fp, "    machine->machine.r_data = machine->region_data;\n");
    fprintf(fp, "    machine->machine.no_of_regions = %i;\n", model->no_of_regions);
    fprintf(fp, "    machine->machine.s_data = machine->state_data;\n");
    fprintf(fp, "    machine->machine.no_of_states = %i;\n", model->no_of_states);
    uu_to_str(model->root->id, uu_str);
    fprintf(fp, "    machine->machine.region = &r_%s;\n", uu_str);
    fprintf(fp, "    ufsm_stack_init(&(machine->machine.stack), %i, machine->stack_data);\n",
                        stack_elements);
    fprintf(fp, "    ufsm_stack_init(&(machine->machine.stack2), %i, machine->stack_data2);\n",
                        stack2_elements);

    fprintf(fp, "    return ufsm_init_machine(&machine->machine, ctx);\n");
    fprintf(fp, "}\n");

    fprintf(fp, "int %s_machine_reset(struct %s_machine *machine)\n",
                    sane_machine_name, sane_machine_name);
    fprintf(fp, "{\n");
    fprintf(fp, "    return ufsm_reset_machine(&machine->machine);\n");
    fprintf(fp, "}\n");

    fprintf(fp, "int %s_machine_process(struct %s_machine *machine, int ev)\n",
                    sane_machine_name, sane_machine_name);
    fprintf(fp, "{\n");
    fprintf(fp, "    return ufsm_process(&machine->machine, ev);\n");
    fprintf(fp, "}\n");

    free(sane_machine_name);
    return rc;
}

static int generate_header_file(struct ufsmm_model *model,
                                const char *filename,
                                unsigned int stack_elements,
                                unsigned int stack2_elements,
                                FILE *fp)
{
    char *sane_machine_name = malloc(strlen(model->name) + 1);
    strcpy(sane_machine_name, model->name);

    sanitize_machine_name(sane_machine_name);

    fprintf(fp, "#ifndef UFSM_MACHINE_%s_H_\n", sane_machine_name);
    fprintf(fp, "#define UFSM_MACHINE_%s_H_\n\n", sane_machine_name);
    fprintf(fp, "#include <stdint.h>\n");
    fprintf(fp, "#include <stddef.h>\n");
    fprintf(fp, "#include <stdbool.h>\n");
    fprintf(fp, "#include <ufsm/ufsm.h>\n\n");

    /* Triggers */
    if (model->triggers) {
        fprintf(fp, "/* Triggers */\n");
        fprintf(fp, "enum {\n");

        for (struct ufsmm_trigger *t = model->triggers; t; t = t->next) {
            fprintf(fp, "    %s,\n", t->name);
        }

        fprintf(fp, "};\n\n");
    }

    /* Guard function prototypes */
    if (model->guards.tqh_first) {
        fprintf(fp, "/* Guard function prototypes */\n");
        struct ufsmm_action *a;
        TAILQ_FOREACH(a, &model->guards, tailq) {
            fprintf(fp, "bool %s(void *context);\n", a->name);
        }

        fprintf(fp, "\n");
    }

    /* Action function prototypes */
    if (model->actions.tqh_first) {
        fprintf(fp, "/* Action function prototypes */\n");

        struct ufsmm_action *a;
        TAILQ_FOREACH(a, &model->actions, tailq) {
            fprintf(fp, "void %s(void *context);\n", a->name);
        }

        fprintf(fp, "\n");
    }

    /* Machine API */


    fprintf(fp, "struct %s_machine {\n", sane_machine_name);
    fprintf(fp, "    struct ufsm_machine machine;\n");
    fprintf(fp, "    struct ufsm_region_data region_data[%i];\n",
                        model->no_of_regions);
    fprintf(fp, "    struct ufsm_state_data state_data[%i];\n",
                        model->no_of_states);
    fprintf(fp, "    void *stack_data[%i];\n", stack_elements);
    fprintf(fp, "    void *stack_data2[%i];\n", stack2_elements);
    fprintf(fp, "};\n\n");

    fprintf(fp, "/* Machine API */\n");
    fprintf(fp, "int %s_machine_initialize(struct %s_machine *machine, void *ctx);\n",
                    sane_machine_name, sane_machine_name);
    fprintf(fp, "int %s_machine_reset(struct %s_machine *machine);\n",
                    sane_machine_name, sane_machine_name);
    fprintf(fp, "int %s_machine_process(struct %s_machine *machine, int ev);\n",
                    sane_machine_name, sane_machine_name);
    free(sane_machine_name);

    fprintf(fp, "#endif  // UFSM_MACHINE_%s_H_\n", filename);
    return 0;
}

static void generate_file_header(FILE *fp)
{
    fprintf(fp, "/* Automatically generated by uFSM version %s */\n\n",
                    PACKAGE_VERSION);
}

int ufsm_gen_output(struct ufsmm_model *model, const char *output_filename,
                     const char *output_path,
                     int verbose, int strip_level)
{
    int rc = 0;
    FILE *fp_c = NULL;
    FILE *fp_h = NULL;

    /* Calculate stack requiremets */
    int stack2_elements = ufsmm_model_calculate_max_orthogonal_regions(model) + 1;

    if (stack2_elements < 0) {
        fprintf(stderr, "Error: Could not calculate max orthogonal regions\n");
        return -1;
    }

    int max_concurrent_states = ufsmm_model_calculate_max_concurrent_states(model);

    if (max_concurrent_states < 0) {
        fprintf(stderr, "Error: Could not calculate max concurrent states\n");
        return -1;
    }

    int nested_region_depth = ufsmm_model_calculate_nested_region_depth(model);

    if (nested_region_depth < 0) {
        fprintf(stderr, "Error: Could not calculate nested region depth\n");
        return -1;
    }

    int max_transitions = ufsmm_model_calculate_max_transitions(model);

    if (max_transitions < 0) {
        fprintf(stderr, "Error: Could not calculate max source transitions\n");
        return -1;
    }

    unsigned int stack_elements  =
                  max_concurrent_states * 2 +
                  nested_region_depth +
                  max_transitions;

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

    rc = generate_header_file(model, output_filename, stack_elements,
                                stack2_elements, fp_h);

    if (rc != 0) {
        fprintf(stderr, "Error: Could not generate header file '%s.h'\n",
                                output_filename);
        goto err_close_fps_out;
    }

    rc = generate_c_file(model, output_filename, stack_elements,
                            stack2_elements, fp_c);

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
