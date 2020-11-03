/**
 * uFSM
 *
 * Copyright (C) 2020 Jonas Blixt <jonpe960@gmail.com>
 *
 * SPDX-License-Identifier: BSD-3-Clause
 *
 */

#include <stdio.h>
#include <strings.h>
#include <getopt.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <stdbool.h>
#include <ufsm.h>
#include <sotc/sotc.h>
#include <sotc/model.h>
#include <sotc/stack.h>

#include "output.h"

static int v = 0;

int sotc_debug(enum sotc_debug_level debug_level,
              const char *func_name,
              const char *fmt, ...)
{
    va_list args;

    if (debug_level > v)
        return 0;

    va_start(args, fmt);
    switch (debug_level)
    {
        case 0:
            printf("E ");
        break;
        case 1:
            printf("I ");
        break;
        case 2:
            printf("D ");
        break;
    }
    printf("%s ", func_name);
    vprintf(fmt, args);
    printf("\n");
    va_end(args);

    return 0;
}

static void display_version(void)
{
    printf("ufsm-import: VERSION\n");
}

static void display_usage(void)
{
    display_version();
    printf("\nUsage:\n");
    printf("    ufsmimport [options]\n\n");
    printf("Options:\n");
    printf("        -i, --input <input filename>            - Input filename\n");
    printf("        -o, --output <output filename>          - Output filename\n");
    printf("        -v, --verbose                           - Verbose\n");
    printf("        -s, --strip=<level>                     - Strip output\n");
    printf("\n");
    printf("Strip levels:\n");
    printf("    0 - Nothing is stripped\n");
    printf("    1 - UUID references stripped, this is the default\n");
    printf("    2 - Strip UUID's and text labels\n");
}

int main(int argc, char **argv)
{
    extern char *optarg;
    int opt;
    int long_index = 0;
    int rc = UFSM_OK;
    const char *output_filename = NULL;
    const char *input_filename = NULL;
    int strip_level = 1;
    struct sotc_model *model;

    struct option long_options[] =
    {
        {"help",      no_argument,       0,  'h' },
        {"version",   no_argument,       0,  'V' },
        {"verbose",   no_argument,       0,  'v' },
        {"input",     required_argument, 0,  'i' },
        {"output",    required_argument, 0,  'o' },
        {"strip",     optional_argument, 0,  's' },
        {0,           0,                 0,   0  }
    };

    if (argc < 2) {
        display_usage();
        exit(0);
    }

    while ((opt = getopt_long(argc, argv, "hVvi:o:s:",
                   long_options, &long_index )) != -1)
    {
        switch (opt) {
            case 'v':
                v++;
            break;
            case 'V':
                display_version();
                exit(0);
                break;
            break;
            case 's':
                if (optarg) {
                    strip_level = (int) strtol(optarg, NULL, 10);
                }
            break;
            case 'h':
                display_usage();
                exit(0);
            break;
            case 'i':
                input_filename = optarg;
            break;
            case 'o':
                output_filename = optarg;
            break;
            default:
                display_usage();
                exit(-1);
        }
    }

    if (!input_filename) {
        fprintf(stderr, "Error: No input filename\n");
        rc = -UFSM_ERROR;
        goto err_out;
    }

    if (!output_filename) {
        fprintf(stderr, "Error: No output filename\n");
        rc = -UFSM_ERROR;
        goto err_out;
    }

    if (v) {
        printf("Input '%s'\n", input_filename);
        printf("Output '%s'\n", output_filename);
        printf("Strip level = %i\n", strip_level);
    }

    rc = sotc_model_load(input_filename, &model);

    if (rc != SOTC_OK) {
        fprintf(stderr, "Error: Could not load model '%s'\n", input_filename);
        goto err_out;
    }

    rc = ufsm_gen_output(model, output_filename, v, strip_level);

    sotc_model_free(model);
err_out:
    return rc;
}
