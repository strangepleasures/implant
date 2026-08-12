"""Small utilities used by main."""

DEFAULT_NAME = "World"


def greet(name: str) -> str:
    """Return a friendly greeting for ``name``."""
    if not name:
        raise ValueError("name must not be empty")
    return f"Hello, {name}!"


class Adder:
    """Adds a base value to any argument."""

    def __init__(self, base: int) -> None:
        self.base = base

    def add(self, x: int) -> int:
        """Add ``x`` to the base."""
        if not isinstance(x, int):
            raise TypeError("x must be int")
        return self.base + x
