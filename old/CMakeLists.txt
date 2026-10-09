cmake_minimum_required(VERSION 3.10)

# Extract version info the generator pyproject.toml
file(READ "generator/pyproject.toml" ver)

string(REGEX MATCH "version = \"([0-9]+)\.([0-9]+)\.([0-9]+)\"" _ ${ver})
set(ver_major ${CMAKE_MATCH_1})
set(ver_minor ${CMAKE_MATCH_2})
set(ver_patch ${CMAKE_MATCH_3})

project(ufsm-compose VERSION "${ver_major}.${ver_minor}.${ver_patch}"
                     DESCRIPTION "uFSM Compose"
                     HOMEPAGE_URL https://github.com/jonasblixt/ufsm
)

enable_language(C)
enable_testing()
set(CMAKE_C_STANDARD 99)

add_definitions(-DUFSM_VERSION="${ver_major}.${ver_minor}.${ver_patch}")
option(UFSM_BUILD_TESTS "Build test cases" OFF)

add_subdirectory("compose")

if (UFSM_BUILD_TESTS)
    add_subdirectory("tests")
endif()
