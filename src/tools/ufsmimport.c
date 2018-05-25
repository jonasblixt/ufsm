#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <stdbool.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <ufsm.h>

#include "output.h"

static struct ufsm_machine *root_machine;

static xmlChar *get_attr(xmlNode *n, const char* id)
{
    xmlAttr* attribute = n->properties;
    while(attribute)
    {
        xmlChar* value = xmlNodeListGetString(n->doc, attribute->children, 1);
        if (value) {
            if (strcmp((const char *)attribute->name, id) == 0)
                return value;
            xmlFree(value);
        } 
        attribute = attribute->next;
    }
    return NULL;
}

static bool is_type(xmlNode *n, const char *id)
{
    xmlChar *type_name = get_attr(n, "type");
    if (type_name == NULL)
        return false;
    bool result = (strcmp((const char *)type_name, id) == 0);
    xmlFree(type_name);
    return result;
}


static struct ufsm_machine * ufsmimport_get_machine(struct ufsm_machine *root,
                                                    const char *id) 
{
    if (id == NULL)
        return NULL;

    for (struct ufsm_machine *m = root; m; m = m->next) {
        if (strcmp((char *) id, (char *) m->id) == 0)
            return m;
    }
    return NULL;
}

static struct ufsm_region * _get_region(struct ufsm_region *r,
                                        const char *id)
{
    struct ufsm_region *result = NULL;
 
    if (strcmp((char *) r->id, id) == 0)
        return r;

    if (!r->state)
        return NULL;

    for (struct ufsm_state *s = r->state; s; s = s->next) {
        if (s->region)
            result = _get_region(s->region, id);

        if (result)
            return result;
    }
    
    return NULL;
}


static struct ufsm_region * ufsmimport_get_region(struct ufsm_machine *root,
                                                    const char *id) 
{
    struct ufsm_region *result = NULL;

    if (id == NULL)
        return NULL;

    for (struct ufsm_machine *m = root; m; m = m->next) {
        if (m->region)
            result = _get_region(m->region, id);

        if (result)
            return result;
    }
    return NULL;
}


static struct ufsm_state * _get_state(struct ufsm_region *regions,
                                      const char *id)
{
    struct ufsm_state *result = NULL;


    for (struct ufsm_region *r = regions; r; r = r->next) {
        if (r->state) {
            for (struct ufsm_state *s = r->state; s; s = s->next) {
                if (strcmp((char*) s->id, id) == 0)
                    return s;

                result = _get_state(s->region,id);

                if (result)
                    return result;

            }
        }
    }
    return NULL;
}

static struct ufsm_state * ufsmimport_get_state(struct ufsm_machine *root,
                                                    const char *id) 
{
    struct ufsm_state *result = NULL;

    for (struct ufsm_machine *m = root; m; m = m->next) {
        if (m->region)
            result = _get_state(m->region, id);

        if (result)
            return result;
    }
    return NULL;
}



static uint32_t parse_region(xmlNode *n, struct ufsm_machine *m, 
                                         struct ufsm_region *r);


static void parse_state(xmlNode *n, struct ufsm_machine *m,
                                    struct ufsm_region *r,
                                    struct ufsm_state *s) 
{
    struct ufsm_region *state_region = NULL;
    struct ufsm_region *state_region_last = NULL;

    if (get_attr(n, "name"))
        s->name = (const char *) get_attr(n, "name");
    
    s->id = (const char*) get_attr(n, "id");
    s->entry = NULL;
    s->exit = NULL;

    printf ("    S %-25s %s\n",s->name,s->id);

    if (get_attr(n,"submachine")) {
        s->submachine = ufsmimport_get_machine(root_machine,
                            (const char*) get_attr(n,"submachine"));   
    }

    if (s->submachine)
        printf ("      o-o M %-19s %s\n",s->submachine->name, s->submachine->id);
    
    struct ufsm_entry_exit *entry = NULL;
    struct ufsm_entry_exit *entry_last = NULL;
 
    /* Parse regions */
    for (xmlNode *r_sub = n->children; r_sub; r_sub = r_sub->next) {
        if (is_type(r_sub, "uml:Region")) {
            state_region = malloc (sizeof(struct ufsm_region));
            state_region->next = state_region_last;
            parse_region(r_sub, m, state_region);
            state_region_last = state_region;
        }
        if(strcmp((char *)r_sub->name, "entry") == 0) {
            entry = malloc(sizeof(struct ufsm_entry_exit));
            entry->name = (const char*) get_attr(r_sub,"name");
            entry->id = (const char *) get_attr(r_sub, "id");
            entry->next = entry_last;
            entry_last = entry;
        }
    }
    s->entry = entry_last;
    s->region = state_region_last;
}


static uint32_t parse_transition(xmlNode *n, struct ufsm_machine *m,
                                             struct ufsm_region *r)
{
    struct ufsm_transition *t = NULL;
    struct ufsm_transition *t_last = NULL;
 
    if (n->children == NULL)
        return UFSM_ERROR;

    for (xmlNode *s_node = n->children; s_node; s_node = s_node->next) {

        if (is_type(s_node, "uml:State")) {
            for (xmlNode *r_node = s_node->children; r_node; r_node = r_node->next) {
                struct ufsm_region *region = ufsmimport_get_region(m, 
                                        (const char*) get_attr(r_node,"id"));
                if (region)
                    parse_transition(s_node, m, region);
            }
        }

        if (is_type(s_node, "uml:Transition")) {
            t = malloc(sizeof(struct ufsm_transition));
            t->id = (const char*) get_attr(s_node, "id");
            t->next = t_last;
            t_last = t;
            struct ufsm_state *src = ufsmimport_get_state(
                                    m, (const char *) get_attr(s_node, "source"));

            struct ufsm_state *dest = ufsmimport_get_state(
                                    m, (const char *) get_attr(s_node, "target"));

            t->source = src;
            t->dest = dest;
            
            struct ufsm_event *ev_last = NULL;
            struct ufsm_action *action = NULL;
            struct ufsm_action *action_last = NULL;
            struct ufsm_guard *guard = NULL;
            struct ufsm_guard *guard_last = NULL;

            for (xmlNode *trigger = s_node->children; trigger; trigger = trigger->next) {
                if (is_type(trigger, "uml:Trigger")) {
                    struct ufsm_event *ev = malloc(sizeof(struct ufsm_event));
                    ev->id = (const char*) get_attr(trigger,"id");
                    ev->name = (const char*) get_attr(trigger, "name");
                    ev->next = ev_last;
                    ev_last = ev;
                    printf ("%.4s", ev->name);
                }
                
                if (is_type(trigger, "uml:Activity")) {
                    action = malloc (sizeof (struct ufsm_action));
                    action->name = (const char*) get_attr(trigger, "name");
                    action->id = (const char *) get_attr(trigger, "id");
                    action->next = action_last;
                    action_last = action;
                    printf (" /%s ", action->name);
                }

                if (is_type(trigger, "uml:Constraint")) {
                    guard = malloc(sizeof(struct ufsm_guard));
                    guard->name = (const char*) get_attr(trigger, "specification");
                    guard->id = (const char*) get_attr(trigger, "id");
                    guard->next = guard_last;
                    guard_last = guard;
                    printf (" [%s] ", guard->name);
                }
 
            }
            t->action = action_last;
            t->guard = guard_last;
            
            printf (" T  %-10s -> %-10s %s\n", src->name, 
                                               dest->name, 
                                               t->id);
        }
    }
    r->transition = t_last;
    return UFSM_OK;
}


static uint32_t parse_region(xmlNode *n, struct ufsm_machine *m, 
                                         struct ufsm_region *r) 
{
    struct ufsm_state *s = NULL;
    struct ufsm_state *s_last = NULL;

    r->name = (const char *) get_attr(n, "name");
    r->id = (const char*) get_attr(n, "id");

    if (r->name == NULL) {
        r->name = malloc(strlen(m->name)+7);
        sprintf((char * restrict) r->name,"%sregion",m->name);
    }

    printf ("    R %-25s %s\n", r->name, r->id);
    for (xmlNode *s_node = n->children; s_node; s_node = s_node->next) {
        if (is_type(s_node, "uml:State")) {
            s = malloc (sizeof(struct ufsm_state));
            s->kind = UFSM_STATE_SIMPLE;
            s->next = s_last;
            s_last = s;
            parse_state(s_node, m, r, s);
        } else if (is_type(s_node, "uml:Pseudostate")) {
            s = malloc (sizeof(struct ufsm_state));
            s->name = NULL;
            if (strcmp((char *) get_attr(s_node, "kind"), "initial") == 0) {
                s->name = malloc(64);
                sprintf((char * restrict) s->name,"Init");
                s->kind = UFSM_STATE_INIT;
            } else if (strcmp((char *) get_attr(s_node, "kind"), "shallowHistory") == 0) {
                s->kind = UFSM_STATE_SHALLOW_HISTORY;
            } else if (strcmp((char *) get_attr(s_node, "kind"), "deepHistory") == 0) {
                s->kind = UFSM_STATE_DEEP_HISTORY;
            } else if (strcmp((char *) get_attr(s_node, "kind"), "exitPoint") == 0) {
                s->kind = UFSM_STATE_EXIT_POINT;
            } else {
                printf ("Warning: unknown pseudostate '%s'\n",
                                            get_attr(s_node,"kind"));
            }

            s->next = s_last;
            s_last = s;
            parse_state(s_node, m, r, s);
        } else if (is_type(s_node, "uml:FinalState")) {
            s = malloc (sizeof(struct ufsm_state));
            s->kind = UFSM_STATE_FINAL;
            s->name = malloc(64);
            sprintf((char * restrict) s->name, "Final");
            s->next = s_last;
            s_last = s;
            parse_state(s_node, m, r, s);
        }
    }
 
    r->state = s_last;
    
    return UFSM_OK;
}

static struct ufsm_machine * ufsmimport_pass1 (xmlNode *node) 
{
    xmlNode *n = NULL;
    struct ufsm_machine *m = NULL;
    struct ufsm_machine *m_last = NULL;

    printf ("o Pass 1, analysing state machines...\n");
    for (n = node; n; n = n->next) {
        if (is_type(n, "uml:StateMachine")) {
            m = malloc(sizeof(struct ufsm_machine));
            m->next = m_last;
            m->id = (const char*) get_attr(n, "id");
            m->name = (const char*) get_attr(n, "name");
            m_last = m;
            printf ("    M %-25s %s\n",m->name,m->id);
        }
    }

    return m_last;
}

static uint32_t ufsmimport_pass2 (xmlNode *node, struct ufsm_machine *machines) 
{
    struct ufsm_region *r = NULL;

    printf ("o Pass 2, analysing regions, states and sub machines...\n");
 
    for (xmlNode *m = node; m; m = m->next) {
        for (xmlNode *n = m->children; n; n = n->next) {
            if (is_type(n, "uml:Region")) {
                r = malloc (sizeof(struct ufsm_region));
                r->next = NULL;
                struct ufsm_machine  *mach = ufsmimport_get_machine(machines,
                                            (const char*) get_attr(m, "id"));
                mach->region = r;
                parse_region(n, mach, r);
            }
        }

   }
    
    return UFSM_OK;
}


static uint32_t ufsmimport_pass3 (xmlNode *node, struct ufsm_machine *machines) 
{
    printf ("o Pass 3, analysing transitions...\n");
 
    for (xmlNode *m = node; m; m = m->next) {
        for (xmlNode *n = m->children; n; n = n->next) {
            if (is_type(n, "uml:Region")) {
                struct ufsm_region *region = ufsmimport_get_region(machines,
                                            (const char*) get_attr(n,"id"));
                
                parse_transition(n, machines, region);
            }
        }
    }

    return UFSM_OK;
}


static xmlNode * get_first_statemachine(xmlNode *node) 
{
    xmlNode *n = NULL;
    xmlNode *result = NULL;

    for (n = node; n; n = n->next) {
        if (is_type(n, "uml:StateMachine")) {
            return n;
        }
        if (n->children)
            result = get_first_statemachine(n->children);
    }

   return result;
}

int main(int argc, char **argv) 
{
    xmlDocPtr doc;
    xmlNode *root_element;
    xmlNode *root_machine_element;

    doc = xmlReadFile(argv[1], NULL, 0);
 
  
    if (doc == NULL) {
        printf ("Could not read file\n");
        return -1;
    }

    printf ("o Reading %s...\n", argv[1]);
 
    root_element = xmlDocGetRootElement(doc);
    
    /* XMI identifier */
    if (strcmp((char *) root_element->name, "XMI") != 0) {
        printf ("Error: Not an XMI file\n");
        return -1;
    }
    printf (" XMI v%s\n",get_attr(root_element,"version"));
    
    /* Exporter info */
    root_element = root_element->children;
    root_element = root_element->next;

    printf (" Exporter: %s, exporter version: %s\n", 
                get_attr(root_element, "exporter"),
                get_attr(root_element, "exporterVersion"));
    
    root_machine_element = get_first_statemachine(root_element);

    root_machine = ufsmimport_pass1 (root_machine_element);
    ufsmimport_pass2(root_machine_element, root_machine);
    ufsmimport_pass3(root_machine_element, root_machine);

    ufsm_gen_output(root_machine);

    return 0;
}
