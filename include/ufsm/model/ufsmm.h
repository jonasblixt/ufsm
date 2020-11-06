#ifndef INCLUDE_UFSMM_H_
#define INCLUDE_UFSMM_H_

#include <stdarg.h>

/* This sets the upper limit on how many regions a state can hold
 * and how many states a region can hold */
#define UFSMM_MAX_R_S 1024

/* This sets the total amount of states and regions that can be 
 * allocated */
#define UFSMM_MAX_OBJECTS (1024*1024)

enum ufsmm_errors
{
    UFSMM_OK,
    UFSMM_ERROR,
    UFSMM_ERR_IO,
    UFSMM_ERR_MEM,
    UFSMM_ERR_PARSE,
};

enum ufsmm_debug_level
{
    UFSMM_L_ERROR,
    UFSMM_L_INFO,
    UFSMM_L_DEBUG,
};

#define L_INFO(...) \
         do { ufsmm_debug(1, __func__, __VA_ARGS__); } while (0)

#define L_DEBUG(...) \
         do { ufsmm_debug(2, __func__, __VA_ARGS__); } while (0)

#define L_ERR(...) \
         do { ufsmm_debug(0, __func__, __VA_ARGS__); } while (0)

int ufsmm_debug(enum ufsmm_debug_level debug_level, const char *func_name,
                    const char *fmt, ...);

const char *ufsmm_library_version(void);

#endif  // INCLUDE_UFSMM_H_
