cmake_minimum_required(VERSION 3.10)

# Extract version info from bpak.h
file(READ "src/version.h" ver)

string(REGEX MATCH ".+UFSM_VERSION_MAJOR\ +([0-9]*)" _ ${ver})
set(ver_major ${CMAKE_MATCH_1})

string(REGEX MATCH ".+UFSM_VERSION_MINOR\ +([0-9]*)" _ ${ver})
set(ver_minor ${CMAKE_MATCH_1})

string(REGEX MATCH ".+UFSM_VERSION_PATCH\ +([0-9]*)" _ ${ver})
set(ver_patch ${CMAKE_MATCH_1})

project(ufsm VERSION ${ver_major}.${ver_minor}.${ver_patch}
             DESCRIPTION uFSM
             HOMEPAGE_URL https://github.com/jonasblixt/ufsm
)

enable_language(C)
enable_testing()
set(CMAKE_C_STANDARD 99)

add_compile_options(-Wall -Werror)
include_directories(include/)

option(UFSM_BUILD_TESTS "Build test cases" OFF)

find_library(MBEDCRYPTO_LIBRARY mbedcrypto)

if (BPAK_BUILD_TESTS)
    add_subdirectory("test")
    add_compile_options(-g -fprofile-arcs -ftest-coverage -fstack-usage)
    link_libraries(gcov)
endif()

add_subdirectory("src")
