#include <ufsm/model/ufsmm.h>
#include <stdarg.h>

__attribute__ ((weak)) int ufsmm_debug(enum ufsmm_debug_level debug_level,
                                        const char *func_name,
                                        const char *fmt, ...)
{
    return 0;
}

const char * ufsmm_library_version(void)
{
    return PACKAGE_VERSION;
}
