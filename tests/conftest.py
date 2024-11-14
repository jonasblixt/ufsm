"""This module contains pytest fixtures."""

from pathlib import Path

import pytest


@pytest.fixture(scope="session", name="resource_dir")
def resource_dir_fixture() -> Path:
    """Returns the path to the test resource directory.

    Returns:
        Path: The resource directory path.
    """
    return Path(__file__).parent.joinpath("resources")
