
/**
 * uFSM
 *
 * Copyright (C) 2018 Jonas Persson <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#ifndef __UFSM_OUTPUT_H__
#define __UFSM_OUTPUT_H__

#include <ufsm.h>


bool ufsm_gen_output(struct ufsm_machine *root, char *output_name,
                    char *output_prefix, uint32_t verbose, bool strip);



#endif
