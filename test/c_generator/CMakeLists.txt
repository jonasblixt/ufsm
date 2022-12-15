add_compile_options(
        -fsanitize=address
)

add_link_options(-fsanitize=address)

set(C_TESTS_COMMON
    test_helper.c
)

set(C_TESTS
    test_final
    test_chained_signals
    test_fork_join
    test_guard1
    test_model1
    test_nested_finals
    test_nested_finals2
    test_nested_states
    test_nested_states3
    test_nested_states4
)

set(GEN_OUTPUT ${CMAKE_BINARY_DIR}/gen/)

file(MAKE_DIRECTORY ${GEN_OUTPUT})

foreach(c_test IN LISTS C_TESTS)
    add_custom_command(
        COMMAND ufsm-generate c ${CMAKE_SOURCE_DIR}/test/c_generator/${c_test}.ufsm ${GEN_OUTPUT}
        DEPENDS ${c_test}.ufsm
        OUTPUT ${GEN_OUTPUT}/${c_test}.c ${GEN_OUTPUT}/${c_test}.h
        COMMENT "Generating code for ${c_test}"
    )

    add_executable(${c_test} ${c_test}.c ${GEN_OUTPUT}/${c_test}.c ${C_TESTS_COMMON})
    target_compile_options(${c_test} PRIVATE -I${CMAKE_BINARY_DIR})
    add_test(${c_test} ${c_test})
endforeach()

