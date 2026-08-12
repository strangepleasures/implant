"""Pytest tests — presence of these gives get-code-lenses non-trivial output (Run Test / Debug Test lenses from the Python extension)."""
from utils import Adder, greet


def test_greet_default():
    assert greet("World") == "Hello, World!"


def test_adder_adds():
    assert Adder(10).add(5) == 15
