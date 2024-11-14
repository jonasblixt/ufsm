"""This module contains example tests."""

from pathlib import Path

from ufsm.example import my_function


def test_my_function() -> None:
    expected_value = 42
    assert my_function() == expected_value


def test_use_test_resource(resource_dir: Path) -> None:
    assert resource_dir.joinpath("example_resource.txt").is_file()
