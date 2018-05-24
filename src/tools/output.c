#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ufsm.h>

#include "output.h"

static FILE *fp_c = NULL;
static FILE *fp_h = NULL;

static void ufsm_gen_regions_decl(struct ufsm_region *region);

static void ufsm_gen_states_decl(struct ufsm_state *state)
{
    fprintf(fp_c,"static struct ufsm_state %s;\n",state->name);
    if (state->region)
        ufsm_gen_regions_decl(state->region);

    for (struct ufsm_entry_exit *e = state->entry; e; e = e->next)
        fprintf(fp_c, "static struct ufsm_entry_exit %s;\n",
                        e->name);
    for (struct ufsm_entry_exit *e = state->exit; e; e = e->next)
        fprintf(fp_c, "static struct ufsm_entry_exit %s;\n",
                        e->name);


}

static void ufsm_gen_regions_decl(struct ufsm_region *region) 
{
    for (struct ufsm_region *r = region; r; r = r->next) {
        fprintf (fp_c,"static struct ufsm_region %s;\n",r->name);

        for (struct ufsm_transition *t = r->transition; t; t = t->next) {
            fprintf(fp_c, "static struct ufsm_transition %s_%s_to_%s;\n",
                               r->name,t->source->name,t->dest->name);
        
            for (struct ufsm_action *a = t->action; a; a = a->next)
                fprintf(fp_c, "static struct ufsm_action %s;\n",
                            a->name);


            for (struct ufsm_guard *g = t->guard; g; g = g->next)
                fprintf(fp_c, "static struct ufsm_guard %s;\n",
                            g->name);

        }

        for (struct ufsm_state *s = r->state; s; s = s->next)
            ufsm_gen_states_decl(s);

    }
}

bool ufsm_gen_machine (struct ufsm_machine *m)
{
    char *fn_c = NULL;
    char *fn_h = NULL;
    fn_c = malloc(strlen(m->name)+5);
    sprintf (fn_c, "%s.c",m->name);
    fp_c = fopen(fn_c, "w");

    printf ("  Creating %s\n", fn_c);


    fn_h = malloc(strlen(m->name)+5);
    sprintf (fn_h, "%s.h",m->name);
    fp_h = fopen(fn_h, "w");

    printf ("  Creating %s\n", fn_h);


    fprintf (fp_c,"static struct ufsm_machine %s;\n",m->name);

    ufsm_gen_regions_decl(m->region);

    fclose(fp_c);
    fclose(fp_h);

    return true;
}

bool ufsm_gen_output(struct ufsm_machine *root) {
    printf ("o Generating output\n");

    for (struct ufsm_machine *m = root; m; m = m->next)
        ufsm_gen_machine(m);

    return true;
}
