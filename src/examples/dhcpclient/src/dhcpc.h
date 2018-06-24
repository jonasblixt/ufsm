#ifndef __DHCPC_H__
#define __DHCPC_H__

#include <ufsm.h>

void dhcpc_enable_broadcast(const char* ifacename);
void dhcpc_bcast_request(void);
void dhcpc_reset(struct ufsm_queue* queue);

#endif
