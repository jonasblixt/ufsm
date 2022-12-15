
set(TESTS
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

foreach(c_test IN LISTS TESTS)
    add_custom_command(
        COMMAND ufsm-generate c ${CMAKE_SOURCE_DIR}/tests/${c_test}.ufsm ${GEN_OUTPUT}
        DEPENDS ${c_test}.ufsm
        OUTPUT ${GEN_OUTPUT}/${c_test}.c ${GEN_OUTPUT}/${c_test}.h
        COMMENT "Generating code for ${c_test}"
    )

    add_executable(${c_test} C/test_helper.c C/${c_test}.c ${GEN_OUTPUT}/${c_test}.c)
    target_compile_options(${c_test} PRIVATE -I${CMAKE_BINARY_DIR})
    add_test(c_${c_test} ${c_test})
endforeach()

