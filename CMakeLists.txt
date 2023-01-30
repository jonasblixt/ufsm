cmake_minimum_required(VERSION 3.10)

file(READ "version.txt" ver)
string(STRIP ${ver} ver)

project(ufsm-compose VERSION ${ver}
                     DESCRIPTION "uFSM Compose"
                     HOMEPAGE_URL https://github.com/jonasblixt/ufsm
)

enable_language(C)
enable_testing()
set(CMAKE_C_STANDARD 99)

add_definitions(-DUFSM_VERSION="${ver}")
option(UFSM_BUILD_TESTS "Build test cases" OFF)

add_subdirectory("compose")

if (UFSM_BUILD_TESTS)
    add_subdirectory("tests")
endif()
