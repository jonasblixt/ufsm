#include <stdio.h>
#include <ufsm.h>

static char *state_simple = "Simple State";
static char *state_composite = "Composite State";

static char * get_state_type(const struct ufsm_state *s)
{
    char * result = (char *) ufsm_state_kinds[s->kind];

    if (s->kind == UFSM_STATE_SIMPLE)
    {
        result = state_simple;

        if (s->region)
            result = state_composite;
    }

    return result;
}

static void debug_transition (const struct ufsm_transition *t)
{
    char *source_type, *dest_type;


    source_type = (char *)ufsm_state_kinds[t->source->kind];
    dest_type = (char *)ufsm_state_kinds[t->dest->kind];

    if (t->source->kind == UFSM_STATE_SIMPLE)
    {
        source_type = state_simple;

        if (t->source->region)
            source_type = state_composite;
    }


    if (t->dest->kind == UFSM_STATE_SIMPLE)
    {
        dest_type = state_simple;

        if (t->dest->region)
            dest_type = state_composite;
    }

    printf ("    | Transition | %s {%s} --> %s {%s} T=", t->source->name,
                                            source_type,
                                            t->dest->name,
                                            dest_type);

    if (t->trigger) {
        printf ("%s ", t->trigger->name);
    }

    if (t->trigger == NULL)
        printf ("COMPLETION");

    printf("\n");
}

static void debug_enter_region(const struct ufsm_region *r)
{
    printf ("    | R enter    | %s, H=%i\n", r->name, r->has_history);
}

static void debug_leave_region(const struct ufsm_region *r)
{
    printf ("    | R exit     | %s, H=%i\n", r->name, r->has_history);
}

static void debug_event(int ev)
{
    printf (" %-3i|            |\n",ev);
}

static void debug_action(const struct ufsm_action *a)
{
    printf ("    | Action     | %s()\n",a->name);
}

static void debug_guard(const struct ufsm_guard *g, bool result) 
{
    printf ("    | Guard      | %s() = %i\n", g->name, result);
}

static void debug_enter_state(const struct ufsm_state *s)
{
    printf ("    | S enter    | %s {%s}\n", s->name,get_state_type(s));
}

static void debug_exit_state(const struct ufsm_state *s)
{
    printf ("    | S exit     | %s {%s}\n", s->name,get_state_type(s));
}

static void debug_reset(struct ufsm_machine *m)
{
    printf (" -- | RESET      | %s\n", m->name);
}

static void debug_entry_exit(const struct ufsm_entry_exit *e)
{
    printf ("    | Call       | %s\n", e->name);
}

void ufsm_debug_machine(struct ufsm_machine *m)
{
    printf (" EV |     OP     | Details\n");

    m->debug_transition = &debug_transition;
    m->debug_enter_region = &debug_enter_region;
    m->debug_leave_region = &debug_leave_region;
    m->debug_event = &debug_event;
    m->debug_action = &debug_action;
    m->debug_guard = &debug_guard;
    m->debug_enter_state = &debug_enter_state;
    m->debug_exit_state = &debug_exit_state;
    m->debug_reset = &debug_reset;
    m->debug_entry_exit = &debug_entry_exit;
}
