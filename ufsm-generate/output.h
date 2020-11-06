/**
 * uFSM
 *
 * Copyright (C) 2020 Jonas Blixt <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#ifndef UFSM_OUTPUT_H
#define UFSM_OUTPUT_H

#include <sotc/sotc.h>
#include <sotc/model.h>
#include <ufsm.h>

int ufsm_gen_output(struct sotc_model *model, const char *output_filename,
                     const char *output_path,
                     int verbose, int strip_level);
#endif
