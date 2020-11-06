#include <stdio.h>
#include <sotc/sotc.h>
#include <stdarg.h>
#include "common.h"

int sotc_debug(enum sotc_debug_level debug_level,
              const char *func_name,
              const char *fmt, ...)
{
    va_list args;
    int rc;

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
    return rc;
}
