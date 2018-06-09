/**
 * uFSM - dhcpclient demo
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <stdio.h>
#include <pthread.h>
#include <unistd.h>
#include <linux/if_packet.h>
#include <net/ethernet.h>
#include <sys/socket.h>
#include <ufsm.h>

#include "dhcp_client_fsm.h"
#include "dhcpc.h"

static struct ufsm_machine *m = NULL;
static struct ufsm_queue *q = NULL;
static pthread_mutex_t queue_lock;
static pthread_mutex_t event_loop_lock;
static char *ifacename = NULL;

#define MSG(x...) printf("    | Message    | " x)

/* Debug functions */
static void debug_transition (struct ufsm_transition *t)
{
 
    printf ("    | Transition | %s {%s} --> %s {%s}\n", t->source->name,
                                            ufsm_state_kinds[t->source->kind],
                                            t->dest->name,
                                            ufsm_state_kinds[t->dest->kind]);
}

static void debug_enter_region(struct ufsm_region *r)
{
    printf ("    | R enter    | %s, H=%i\n", r->name, r->has_history);
}

static void debug_leave_region(struct ufsm_region *r)
{
    printf ("    | R exit     | %s, H=%i\n", r->name, r->has_history);
}

static void debug_event(uint32_t ev)
{
    printf (" %-3i|            |\n",ev);
}

static void debug_action(struct ufsm_action *a)
{
    printf ("    | Action     | %s()\n",a->name);
}

static void debug_guard(struct ufsm_guard *g, bool result) 
{
    printf ("    | Guard      | %s() = %i\n", g->name, result);
}

static void debug_enter_state(struct ufsm_state *s)
{
    printf ("    | S enter    | %s {%s}\n", s->name,ufsm_state_kinds[s->kind]);
}

static void debug_exit_state(struct ufsm_state *s)
{
    printf ("    | S exit     | %s {%s}\n", s->name,ufsm_state_kinds[s->kind]);
}

/* uFSM actions/guards */

void dhcp_stop_timers(void)
{
}

void dhcp_disable_broadcast(void)
{
    MSG ("Broadcast disable\n");
}

void dhcp_enable_socket(void)
{
    MSG ("Socket enable\n");
}

void dhcp_send_request(void)
{
    MSG ("Send request\n");
}

void dhcp_display_result(void)
{
}

void dhcp_disable_socket(void)
{
    MSG ("Disable socket\n");
}

void dhcp_enable_broadcast(void)
{
    MSG("Enable broadcast\n");
    dhcpc_enable_broadcast(ifacename);
}

void dhcp_bcast_request(void)
{
    MSG("Bcast request\n");
    dhcpc_bcast_request();
}

void dhcp_set_timers(void)
{
    MSG("Set timers\n");
}

void dhcp_reset(void)
{
    MSG ("DHCP Reset\n");
    dhcpc_reset(q);
    
}

void dhcp_select_offer(void)
{
}

void dhcp_halt_network(void)
{
}

bool dhcp_check(void)
{
    return true;
}

void dhcp_send_decline(void)
{
}

void dhcp_discard_offer(void)
{
}

void dhcp_collect_reply(void)
{
}


/* Help functions */

void dhcp_run_eventloop(void)
{
    pthread_mutex_unlock(&event_loop_lock);
}

void dhcp_lock_queue(void)
{
    pthread_mutex_lock(&queue_lock);
}

void dhcp_unlock_queue(void)
{
    pthread_mutex_unlock(&queue_lock);
}

void * q_test (void *arg)
{
    while (true)
    {
        ufsm_queue_put(q,DHCPACK);
        sleep(1);
    }
}

int main(int argc, char **argv)
{
    bool running = true;
    uint32_t err = UFSM_OK;
    uint32_t ev = 0;

    printf ("uFSM dhcp client demo\n");

    if (argc < 2) {
        printf ("Usage: dhcpclient <network interface>\n");
        return 0;
    }

    ifacename = argv[1];

    if (pthread_mutex_init (&queue_lock, NULL) != 0)
    {
        printf ("Error: Could not initialise queue lock\n");
        return -1;
    }

    if (pthread_mutex_init (&event_loop_lock, NULL) != 0)
    {
        printf ("Error: Could not initialise event loop lock\n");
        return -1;
    }

    m = get_DHCPClient();
    q = ufsm_get_queue(m);

    m->debug_transition = &debug_transition;
    m->debug_enter_region = &debug_enter_region;
    m->debug_leave_region = &debug_leave_region;
    m->debug_event = &debug_event;
    m->debug_action = &debug_action;
    m->debug_guard = &debug_guard;
    m->debug_enter_state = &debug_enter_state;
    m->debug_exit_state = &debug_exit_state;

    q->on_data = &dhcp_run_eventloop;
    q->lock = &dhcp_lock_queue;
    q->unlock = &dhcp_unlock_queue;

    printf (" EV |     OP     | Details\n");
    ufsm_init_machine(m);

    pthread_t t;
    //pthread_create(&t, NULL, &q_test, NULL);
    
    while (running)
    {
        pthread_mutex_lock(&event_loop_lock);
        err = ufsm_queue_get(q, &ev);

        if (err == UFSM_OK) {
            pthread_mutex_unlock(&event_loop_lock);

            err = ufsm_process(m, ev);
            if (err != UFSM_OK)
                MSG ("Error: %s\n", ufsm_errors[err]);
        } else {
            MSG ("Eventloop: No more events to process, sleeping...\n");
        }
    }

    pthread_mutex_destroy(&queue_lock);
    pthread_mutex_destroy(&event_loop_lock);

    return 0;
}


