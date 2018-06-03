#include <stdio.h>
#include <sys/socket.h>
#include <netinet/in.h>

#include <ufsm.h>

#include "dhcpc.h"
#include "dhcp_client_fsm.h"

static struct ufsm_queue *q;
static int s_fd;

void dhcpc_enable_broadcast(const char *ifacename)
{
    s_fd = socket(AF_PACKET, SOCK_RAW, IPPROTO_RAW);

    if (s_fd == -1)
        printf ("Could not open raw socket\n");
}

void dhcpc_bcast_request(void)
{

}

void dhcpc_reset(struct ufsm_queue *queue)
{
    q = queue;
    ufsm_queue_put(q, READY);
}
