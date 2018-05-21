#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <stdbool.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <ufsm.h>


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
    for (struct ufsm_machine *m = root; m; m = m->next) {
        if (strcmp((char *) id, (char *) m->id) == 0)
            return m;
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

    printf ("    S %-25s %s\n",s->name,s->id);

    if (get_attr(n,"submachine")) {
        s->submachine = ufsmimport_get_machine(root_machine,
                            (const char*) get_attr(n,"submachine"));   
    }

    if (s->submachine)
        printf ("      o-o M %-19s %s\n",s->submachine->name, s->submachine->id);
    /* Parse regions */
    for (xmlNode *r_sub = n->children; r_sub; r_sub = r_sub->next) {
        if (is_type(r_sub, "uml:Region")) {
            state_region = malloc (sizeof(struct ufsm_region));
            state_region->next = state_region_last;
            parse_region(r_sub, m, state_region);
            state_region_last = state_region;
        }
    }
    
    s->region = state_region_last;
}


static uint32_t parse_region(xmlNode *n, struct ufsm_machine *m, 
                                         struct ufsm_region *r) 
{
    struct ufsm_state *s = NULL;
    struct ufsm_state *s_last = NULL;

    r->name = (const char *) get_attr(n, "name");
    r->id = (const char*) get_attr(n, "id");

    printf ("    R %-25s %s\n", r->name, r->id);
    for (xmlNode *s_node = n->children; s_node; s_node = s_node->next) {
        if (is_type(s_node, "uml:State")) {
            s = malloc (sizeof(struct ufsm_state));
            s->next = s_last;
            parse_state(s_node, m, r, s);
            s_last = s;
        } else if (is_type(s_node, "uml:Pseudostate")) {
            s = malloc (sizeof(struct ufsm_state));
            
            if (strcmp((char *) get_attr(s_node, "kind"), "initial") == 0) {
                s->name = malloc(64);
                sprintf((char * restrict) s->name,"Init");
                s->kind = UFSM_STATE_INIT;
            } else if (strcmp((char *) get_attr(s_node, "kind"), "shallowHistory") == 0) {
                s->kind = UFSM_STATE_SHALLOW_HISTORY;
            } else if (strcmp((char *) get_attr(s_node, "kind"), "deepHistory") == 0) {
                s->kind = UFSM_STATE_DEEP_HISTORY;
            } else {
                printf ("Warning: unknown pseudostate '%s'\n",
                                            get_attr(s_node,"kind"));
            }

            s->next = s_last;
            parse_state(s_node, m, r, s);
            s_last = s;
        } else if (is_type(s_node, "uml:FinalState")) {
            s = malloc (sizeof(struct ufsm_state));
            s->kind = UFSM_STATE_FINAL;
            s->name = malloc(64);
            sprintf((char * restrict) s->name, "Final");
            s->next = s_last;
            parse_state(s_node, m, r, s);
            s_last = s;
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
    struct ufsm_region *r_last = NULL;

    printf ("o Pass 2, analysing regions, states and sub machines...\n");
 
    for (xmlNode *m = node; m; m = m->next) {
        for (xmlNode *n = m->children; n; n = n->next) {
            if (is_type(n, "uml:Region")) {
                r = malloc (sizeof(struct ufsm_region));
                r->next = r_last;
                parse_region(n, machines, r);
            }
        }
    }
    
    return UFSM_OK;
}


static uint32_t ufsmimport_pass3 (xmlNode *node, struct ufsm_machine *m) 
{
    printf ("o Pass 3, analysing transitions...\n");

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


    return 0;
}
