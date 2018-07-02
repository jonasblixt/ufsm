/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <assert.h>
#include <getopt.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ufsm.h>

#include "output.h"

static struct ufsm_machine* root_machine;
static uint32_t v = 0;
static bool flag_strip = false;

struct ufsmimport_connection_map
{
    char* id;
    char* target_id;
    struct ufsmimport_connection_map* next;
};

static struct ufsmimport_connection_map* conmap;

static xmlChar* get_attr(xmlNode* n, const char* id)
{
    xmlAttr* attribute = n->properties;
    while (attribute)
    {
        xmlChar* value = xmlNodeListGetString(n->doc, attribute->children, 1);
        if (value)
        {
            if (strcmp((const char*)attribute->name, id) == 0)
                return value;
            xmlFree(value);
        }
        attribute = attribute->next;
    }
    return NULL;
}

static bool is_type(xmlNode* n, const char* id)
{
    xmlChar* type_name = get_attr(n, "type");
    if (type_name == NULL)
        return false;
    bool result = (strcmp((const char*)type_name, id) == 0);
    xmlFree(type_name);
    return result;
}

static struct ufsm_machine* ufsmimport_get_machine(struct ufsm_machine* root,
                                                   const char* id)
{
    if (id == NULL)
        return NULL;

    for (struct ufsm_machine* m = root; m; m = m->next)
    {
        if (strcmp((char*)id, (char*)m->id) == 0)
            return m;
    }
    return NULL;
}

static struct ufsm_region* _get_region(struct ufsm_region* r, const char* id)
{
    struct ufsm_region* result = NULL;

    if (strcmp((char*)r->id, id) == 0)
        return r;

    if (!r->state)
        return NULL;

    for (struct ufsm_state* s = r->state; s; s = s->next)
    {
        if (s->region)
            result = _get_region(s->region, id);

        if (result)
            return result;
    }

    return NULL;
}

static struct ufsm_region* ufsmimport_get_region(struct ufsm_machine* root,
                                                 const char* id)
{
    struct ufsm_region* result = NULL;

    if (id == NULL)
        return NULL;

    for (struct ufsm_machine* m = root; m; m = m->next)
    {
        if (m->region)
            result = _get_region(m->region, id);

        if (result)
            return result;
    }
    return NULL;
}

static struct ufsm_state* _get_state(struct ufsm_region* regions,
                                     const char* id)
{
    struct ufsm_state* result = NULL;

    for (struct ufsm_region* r = regions; r; r = r->next)
    {
        if (r->state)
        {
            for (struct ufsm_state* s = r->state; s; s = s->next)
            {
                if (strcmp((char*)s->id, id) == 0)
                    return s;

                result = _get_state(s->region, id);

                if (result)
                    return result;
            }
        }
    }
    return NULL;
}

static struct ufsm_state* ufsmimport_get_state(struct ufsm_machine* root,
                                               const char* id)
{
    struct ufsm_state* result = NULL;

    for (struct ufsm_machine* m = root; m; m = m->next)
    {
        if (m->region)
            result = _get_state(m->region, id);

        if (result)
            return result;
    }

    if (result == NULL)
    {
        for (struct ufsmimport_connection_map* cm = conmap; cm; cm = cm->next)
        {
            if (strcmp(id, cm->id) == 0)
                result = ufsmimport_get_state(root, cm->target_id);
        }
    }

    return result;
}

static uint32_t parse_region(xmlNode* n,
                             struct ufsm_machine* m,
                             struct ufsm_region* r,
                             bool deep_history);

static uint32_t parse_state(xmlNode* n,
                            struct ufsm_machine* m,
                            struct ufsm_region* r,
                            struct ufsm_state* s,
                            bool deep_history)
{
    struct ufsm_region* state_region = NULL;
    struct ufsm_region* state_region_last = NULL;
    uint32_t region_count = 0;

    if (get_attr(n, "name"))
        s->name = (const char*)get_attr(n, "name");

    s->id = (const char*)get_attr(n, "id");
    s->entry = NULL;
    s->exit = NULL;
    s->parent_region = r;

    if (v)
        printf("    S %-25s %s %i\n", s->name, s->id, deep_history);

    if (get_attr(n, "submachine"))
    {
        s->submachine =
            ufsmimport_get_machine(root_machine,
                                   (const char*)get_attr(n, "submachine"));
        // if (s->submachine->region)
        //    s->submachine->region->parent_state = s;
    }

    /* TODO: Should deep history propagate to sub statemachines? */
    if (s->submachine)
        if (v)
            printf("      o-o M %-19s %s\n",
                   s->submachine->name,
                   s->submachine->id);

    struct ufsm_entry_exit* entry = NULL;
    struct ufsm_entry_exit* entry_last = NULL;
    struct ufsm_entry_exit* exits = NULL;
    struct ufsm_entry_exit* exits_last = NULL;
    struct ufsm_doact* doact = NULL;
    struct ufsm_doact* doact_last = NULL;

    /* Parse regions */
    for (xmlNode* r_sub = n->children; r_sub; r_sub = r_sub->next)
    {
        if (is_type(r_sub, "uml:Region"))
        {
            state_region = malloc(sizeof(struct ufsm_region));
            bzero(state_region, sizeof(struct ufsm_region));
            state_region->parent_state = s;
            state_region->next = state_region_last;
            state_region->has_history = deep_history;
            parse_region(r_sub, m, state_region, deep_history);

            if (state_region->name == NULL)
            {
                state_region->name = malloc(strlen(s->name) + 32);
                sprintf((char*)state_region->name,
                        "%sregion%i",
                        s->name,
                        region_count++);
            }

            state_region_last = state_region;
        }
        else if (strcmp((char*)r_sub->name, "entry") == 0)
        {
            entry = malloc(sizeof(struct ufsm_entry_exit));
            bzero(entry, sizeof(struct ufsm_entry_exit));
            entry->name = (const char*)get_attr(r_sub, "name");
            entry->id = (const char*)get_attr(r_sub, "id");
            entry->next = entry_last;
            entry_last = entry;
        }
        else if (strcmp((char*)r_sub->name, "exit") == 0)
        {
            exits = malloc(sizeof(struct ufsm_entry_exit));
            bzero(exits, sizeof(struct ufsm_entry_exit));
            exits->name = (const char*)get_attr(r_sub, "name");
            exits->id = (const char*)get_attr(r_sub, "id");
            exits->next = exits_last;
            exits_last = exits;
        }
        else if (strcmp((char*)r_sub->name, "doActivity") == 0)
        {
            doact = malloc(sizeof(struct ufsm_doact));
            bzero(doact, sizeof(struct ufsm_doact));
            doact->name = (const char*)get_attr(r_sub, "name");
            doact->id = (const char*)get_attr(r_sub, "id");
            doact->next = doact_last;
            doact_last = doact;
        }
        else if (strcmp((char*)r_sub->name, "text") == 0)
        {
            /* Do nothing */
        }
        else if (strcmp((char*)r_sub->name, "connection") == 0)
        {
            struct ufsmimport_connection_map* cm = NULL;

            if (conmap == NULL)
            {
                conmap = malloc(sizeof(struct ufsmimport_connection_map));
                bzero(conmap, sizeof(struct ufsmimport_connection_map));
                cm = conmap;
            }
            else
            {
                conmap->next = malloc(sizeof(struct ufsmimport_connection_map));
                bzero(conmap->next, sizeof(struct ufsmimport_connection_map));
                cm = conmap->next;
            }
            cm->id = (char*)get_attr(r_sub, "id");
            cm->target_id = (char*)get_attr(r_sub->children->next, "idref");
            if (v)
                printf(" Created connection reference %s -> %s\n",
                       cm->id,
                       cm->target_id);
        }
        else
        {
            printf("Error: Unknown element in state definition: '%s'\n",
                   r_sub->name);
            return UFSM_ERROR;
        }
    }
    s->entry = entry_last;
    s->doact = doact_last;
    s->exit = exits_last;
    s->region = state_region_last;

    return UFSM_OK;
}

static struct ufsm_region* _state_belongs_to(struct ufsm_region* region,
                                             struct ufsm_state* state)
{
    struct ufsm_region* result = NULL;

    for (struct ufsm_region* r = region; r; r = r->next)
    {
        for (struct ufsm_state* s = r->state; s; s = s->next)
        {
            if (s == state)
                return r;
            if (s->region)
            {
                result = _state_belongs_to(s->region, state);
                if (result)
                    return result;
            }
        }
    }

    return NULL;
}

static struct ufsm_region* state_belongs_to(struct ufsm_machine* machine,
                                            struct ufsm_state* state)
{
    struct ufsm_region* result = NULL;

    for (struct ufsm_machine* m = machine; m; m = m->next)
    {
        result = _state_belongs_to(m->region, state);
        if (result)
            return result;
    }

    return NULL;
}

static uint32_t parse_transition(xmlNode* n,
                                 struct ufsm_machine* m,
                                 struct ufsm_region* r)
{
    struct ufsm_transition* t = NULL;

    if (n->children == NULL)
        return UFSM_ERROR;

    for (xmlNode* s_node = n->children; s_node; s_node = s_node->next)
    {
        if (is_type(s_node, "uml:State"))
        {
            for (xmlNode* r_node = s_node->children; r_node;
                 r_node = r_node->next)
            {
                struct ufsm_region* region =
                    ufsmimport_get_region(m,
                                          (const char*)get_attr(r_node, "id"));
                if (region)
                    parse_transition(r_node, m, region);
            }
        }

        if (is_type(s_node, "uml:Transition"))
        {
            t = malloc(sizeof(struct ufsm_transition));
            bzero(t, sizeof(struct ufsm_transition));
            t->id = (const char*)get_attr(s_node, "id");
            t->next = NULL;
            struct ufsm_state* src =
                ufsmimport_get_state(m,
                                     (const char*)get_attr(s_node, "source"));

            struct ufsm_state* dest =
                ufsmimport_get_state(m,
                                     (const char*)get_attr(s_node, "target"));

            t->source = src;
            t->dest = dest;

            char* t_kind = (char*)get_attr(s_node, "kind");

            if (strcmp(t_kind, "internal") == 0)
                t->kind = UFSM_TRANSITION_INTERNAL;
            else if (strcmp(t_kind, "external") == 0)
                t->kind = UFSM_TRANSITION_EXTERNAL;
            else if (strcmp(t_kind, "local") == 0)
                t->kind = UFSM_TRANSITION_LOCAL;

            struct ufsm_action* action = NULL;
            struct ufsm_action* action_last = NULL;
            struct ufsm_guard* guard = NULL;
            struct ufsm_guard* guard_last = NULL;

            for (xmlNode* trigger = s_node->children; trigger;
                 trigger = trigger->next)
            {
                if (is_type(trigger, "uml:Trigger"))
                {
                    t->trigger_name = (const char*)get_attr(trigger, "name");
                }
                else if (is_type(trigger, "uml:Activity")
                         || is_type(trigger, "uml:OpaqueBehavior"))
                {
                    action = malloc(sizeof(struct ufsm_action));
                    bzero(action, sizeof(struct ufsm_action));
                    action->name = (const char*)get_attr(trigger, "name");
                    action->id = (const char*)get_attr(trigger, "id");
                    action->next = NULL;
                    if (action_last)
                        action_last->next = action;
                    action_last = action;
                    if (v)
                        printf(" /%s ", action->name);
                }
                else if (is_type(trigger, "uml:Constraint"))
                {
                    guard = malloc(sizeof(struct ufsm_guard));
                    bzero(guard, sizeof(struct ufsm_guard));
                    guard->name = (const char*)get_attr(trigger,
                                                        "specification");
                    guard->id = (const char*)get_attr(trigger, "id");
                    guard->next = guard_last;
                    guard_last = guard;
                    if (v)
                        printf(" [%s] ", guard->name);
                }
                else if (strcmp((char*)trigger->name, "text") == 0)
                {
                    /* Ignore */
                }
                else if (strcmp((char*)trigger->name, "ownedMember") == 0)
                {
                    /* Ignore */
                }
                else if (strcmp((char*)trigger->name, "trigger") == 0)
                {
                    /* Ignore */
                }
                else
                {
                    printf("Unhandeled type '%s' in transition\n",
                           trigger->name);
                    return UFSM_ERROR;
                }
            }
            t->action = action_last;
            t->guard = guard_last;

            struct ufsm_region* trans_region = state_belongs_to(m, src);

            if (trans_region->transition == NULL)
            {
                trans_region->transition = t;
            }
            else
            {
                struct ufsm_transition* tail = trans_region->transition;
                do
                {
                    if (tail->next == NULL)
                    {
                        tail->next = t;
                        break;
                    }
                    tail = tail->next;
                } while (tail);
            }

            if (v)
                printf("   src belongs to %s\n",
                       state_belongs_to(m, src)->name);
            if (v)
                printf(" T  %-10s -> %-10s %s\n", src->name, dest->name, t->id);
        }
    }

    return UFSM_OK;
}

static uint32_t parse_region(xmlNode* n,
                             struct ufsm_machine* m,
                             struct ufsm_region* r,
                             bool deep_history)
{
    bool has_deep_history = deep_history;
    uint32_t err = UFSM_OK;
    struct ufsm_state* s = NULL;
    struct ufsm_state* s_last = NULL;

    r->name = (const char*)get_attr(n, "name");
    r->id = (const char*)get_attr(n, "id");
    r->has_history = has_deep_history;

    if (v)
        printf("    R %-25s %s %i\n", r->name, r->id, deep_history);
    for (xmlNode* s_node = n->children; s_node; s_node = s_node->next)
    {
        if (is_type(s_node, "uml:Pseudostate"))
        {
            s = malloc(sizeof(struct ufsm_state));
            bzero(s, sizeof(struct ufsm_state));
            s->name = NULL;
            char* node_kind = (char*)get_attr(s_node, "kind");

            if (strcmp(node_kind, "initial") == 0)
            {
                s->name = malloc(64);
                sprintf((char* restrict)s->name, "Init");
                s->kind = UFSM_STATE_INIT;
            }
            else if (strcmp(node_kind, "shallowHistory") == 0)
            {
                r->has_history = true;
                s->kind = UFSM_STATE_SHALLOW_HISTORY;
            }
            else if (strcmp(node_kind, "deepHistory") == 0)
            {
                r->has_history = true;
                has_deep_history = true;
                s->kind = UFSM_STATE_DEEP_HISTORY;
            }
            else if (strcmp(node_kind, "exitPoint") == 0)
            {
                s->kind = UFSM_STATE_EXIT_POINT;
            }
            else if (strcmp(node_kind, "entryPoint") == 0)
            {
                s->kind = UFSM_STATE_ENTRY_POINT;
            }
            else if (strcmp(node_kind, "join") == 0)
            {
                s->kind = UFSM_STATE_JOIN;
            }
            else if (strcmp(node_kind, "fork") == 0)
            {
                s->kind = UFSM_STATE_FORK;
            }
            else if (strcmp(node_kind, "choice") == 0)
            {
                s->kind = UFSM_STATE_CHOICE;
            }
            else if (strcmp(node_kind, "junction") == 0)
            {
                s->kind = UFSM_STATE_JUNCTION;
            }
            else if (strcmp(node_kind, "terminate") == 0)
            {
                s->kind = UFSM_STATE_TERMINATE;
            }
            else
            {
                printf("Warning: unknown pseudostate '%s'\n",
                       get_attr(s_node, "kind"));
            }

            s->next = s_last;
            s_last = s;
            err = parse_state(s_node, m, r, s, false);

            if (err != UFSM_OK)
                return err;
        }
        else if (is_type(s_node, "uml:FinalState"))
        {
            s = malloc(sizeof(struct ufsm_state));
            bzero(s, sizeof(struct ufsm_state));
            s->kind = UFSM_STATE_FINAL;
            s->name = malloc(64);
            sprintf((char* restrict)s->name, "Final");
            s->next = s_last;
            s_last = s;
            err = parse_state(s_node, m, r, s, false);
            if (err != UFSM_OK)
                return err;
        }
    }

    for (xmlNode* s_node = n->children; s_node; s_node = s_node->next)
    {
        if (is_type(s_node, "uml:State"))
        {
            s = malloc(sizeof(struct ufsm_state));
            bzero(s, sizeof(struct ufsm_state));
            s->kind = UFSM_STATE_SIMPLE;
            s->next = s_last;
            s_last = s;
            err = parse_state(s_node, m, r, s, has_deep_history);
            if (err != UFSM_OK)
                return err;
        }
    }

    r->state = s_last;

    return UFSM_OK;
}

static struct ufsm_machine* ufsmimport_pass1(xmlNode* node)
{
    xmlNode* n = NULL;
    struct ufsm_machine* m = NULL;
    struct ufsm_machine* m_last = NULL;
    struct ufsm_machine* m_first = NULL;
    if (v)
        printf("o Pass 1, analysing state machines...\n");
    for (n = node; n; n = n->next)
    {
        if (is_type(n, "uml:StateMachine"))
        {
            m = malloc(sizeof(struct ufsm_machine));
            bzero(m, sizeof(struct ufsm_machine));
            if (!m_first)
                m_first = m;
            if (m_last)
                m_last->next = m;
            // m->next = m_last;
            m->id = (const char*)get_attr(n, "id");
            m->name = (const char*)get_attr(n, "name");
            m_last = m;
            if (v)
                printf("    M %-25s %s\n", m->name, m->id);
        }
    }

    return m_first;
}

static uint32_t ufsmimport_pass2(xmlNode* node, struct ufsm_machine* machines)
{
    struct ufsm_region* r = NULL;
    uint32_t region_count = 0;
    uint32_t err = UFSM_OK;

    if (v)
        printf("o Pass 2, analysing regions, states and sub machines...\n");

    for (xmlNode* m = node; m; m = m->next)
    {
        region_count = 0;
        for (xmlNode* n = m->children; n; n = n->next)
        {
            if (is_type(n, "uml:Region"))
            {
                r = malloc(sizeof(struct ufsm_region));
                bzero(r, sizeof(struct ufsm_region));
                r->next = NULL;
                struct ufsm_machine* mach =
                    ufsmimport_get_machine(machines,
                                           (const char*)get_attr(m, "id"));
                mach->region = r;
                r->parent_state = NULL;
                err = parse_region(n, mach, r, false);

                if (err != UFSM_OK)
                    return err;
                if (r->name == NULL)
                {
                    r->name = malloc(strlen(mach->name) + 16);
                    sprintf((char*)r->name,
                            "%sregion%i",
                            mach->name,
                            region_count++);
                }
            }
        }
    }

    return UFSM_OK;
}

static uint32_t ufsmimport_pass3(xmlNode* node, struct ufsm_machine* machines)
{
    if (v)
        printf("o Pass 3, analysing transitions...\n");

    for (xmlNode* m = node; m; m = m->next)
    {
        for (xmlNode* n = m->children; n; n = n->next)
        {
            if (is_type(n, "uml:Region"))
            {
                struct ufsm_region* region =
                    ufsmimport_get_region(machines,
                                          (const char*)get_attr(n, "id"));

                parse_transition(n, machines, region);
            }
        }
    }

    return UFSM_OK;
}

static xmlNode* get_first_statemachine(xmlNode* node)
{
    xmlNode* n = NULL;
    xmlNode* result = NULL;

    for (n = node; n; n = n->next)
    {
        if (is_type(n, "uml:StateMachine"))
        {
            return n;
        }
        if (n->children)
            result = get_first_statemachine(n->children);
    }

    return result;
}

int main(int argc, char** argv)
{
    extern char* optarg;
    extern int optind, opterr, optopt;
    char c;
    uint32_t err = UFSM_OK;
    char* output_prefix = NULL;
    char* output_name = NULL;
    xmlDocPtr doc;
    xmlNode* root_element;
    xmlNode* root_machine_element;

    if (argc < 3)
    {
        printf("Usage: ufsmimport <input.xmi> <output name> [options]\n");
        printf("                              -v          - Verbose\n");
        printf("                              -c prefix/  - Output prefix\n");
        printf("                              -s          - Strip output\n");

        exit(0);
    }

    doc = xmlReadFile(argv[1], NULL, 0);
    output_name = argv[2];

    while ((c = getopt(argc - 2, argv + 2, "svc:")) != -1)
    {
        switch (c)
        {
            case 'c':
                output_prefix = optarg;
                break;
            case 'v':
                v++;
                break;
            case 's':
                flag_strip = true;
                break;
            default:
                abort();
        }
    }

    if (doc == NULL)
    {
        printf("Could not read file\n");
        return -1;
    }

    if (v)
        printf("o Reading...\n");

    root_element = xmlDocGetRootElement(doc);

    /* XMI identifier */
    if (strcmp((char*)root_element->name, "XMI") != 0)
    {
        printf("Error: Not an XMI file\n");
        return -1;
    }
    if (v)
        printf(" XMI v%s\n", get_attr(root_element, "version"));

    /* Exporter info */
    root_element = root_element->children;
    root_element = root_element->next;

    if (v)
        printf(" Exporter: %s, exporter version: %s\n",
               get_attr(root_element, "exporter"),
               get_attr(root_element, "exporterVersion"));

    root_machine_element = get_first_statemachine(root_element);

    root_machine = ufsmimport_pass1(root_machine_element);

    if (!root_machine)
    {
        printf("Error: Pass 1 failed, found no root machine\n");
        return UFSM_ERROR;
    }

    err = ufsmimport_pass2(root_machine_element, root_machine);
    if (err != UFSM_OK)
    {
        printf("Error: pass2 failed with error code '%i'\n", err);
        return err;
    }

    err = ufsmimport_pass3(root_machine_element, root_machine);

    if (err != UFSM_OK)
    {
        printf("Error: pass3 failed with error code '%i'\n", err);
        return err;
    }

    if (output_prefix == NULL)
    {
        output_prefix = malloc(2);
        *output_prefix = 0;
    }

    if (v)
        printf("Output prefix: %s\n", output_prefix);
    ufsm_gen_output(root_machine, output_name, output_prefix, v, flag_strip);

    return err;
}
