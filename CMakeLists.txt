cmake_minimum_required(VERSION 3.10)


project(ufsm-compose VERSION 1.0.0
                     DESCRIPTION "uFSM Compose"
                     HOMEPAGE_URL https://github.com/jonasblixt/ufsm
)

enable_language(C)
enable_testing()
set(CMAKE_C_STANDARD 99)

option(UFSM_BUILD_TESTS "Build test cases" OFF)

add_subdirectory("compose")

if (UFSM_BUILD_TESTS)
    add_subdirectory("tests")
endif()
