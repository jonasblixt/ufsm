cmake_minimum_required(VERSION 3.10)


project(ufsm-compose VERSION 1.0.0
                     DESCRIPTION "uFSM Compose"
                     HOMEPAGE_URL https://github.com/jonasblixt/ufsm
)

enable_language(C)
enable_testing()
set(CMAKE_C_STANDARD 99)

option(UFSM_BUILD_TESTS "Build test cases" OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(GTK3 REQUIRED gtk+-3.0)
pkg_check_modules(JSONC REQUIRED json-c)
pkg_check_modules(CAIRO REQUIRED cairo)
pkg_check_modules(LIBUUID REQUIRED uuid)

set(CFLAGS
    -Wextra -Wall -pedantic -O2
    ${GTK3_CFLAGS}
    ${JSONC_CFLAGS}
    ${CAIRO_CFLAGS}
    ${LIBUUID_CFLAGS}
)

set(LDFLAGS
    -lm
    ${GTK3_LDFLAGS}
    ${JSONC_LDFLAGS}
    ${CAIRO_LDFLAGS}
    ${LIBUUID_LDFLAGS}
)

SET(SRC_FILES
    src/main.c
    src/controller.c
    src/copypaste.c
    src/menu.c
    src/nav.c
    src/pan_and_scale.c
    src/render.c
    src/stack.c
    src/status.c
    src/undo.c
    src/utils.c
    src/model/model.c
    src/model/region.c
    src/model/state.c
    src/model/transition.c
    src/dialogs/add_action_dialog.c
    src/dialogs/add_guard_dialog.c
    src/dialogs/edit_state_dialog.c
    src/dialogs/edit_string_dialog.c
    src/dialogs/project_settings.c
    src/dialogs/save.c
    src/dialogs/set_trigger_dialog.c
    src/logic/canvas.c
)

add_executable(${PROJECT_NAME} ${SRC_FILES})
target_link_libraries(${PROJECT_NAME} ${LDFLAGS})
target_compile_options(${PROJECT_NAME} PRIVATE ${CFLAGS})

add_subdirectory("test/c_generator")
