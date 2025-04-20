import re

def camel_to_snake(name: str) -> str:
    """Convert camelCase or PascalCase to snake_case."""
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


def shishkabob_to_camel(name: str) -> str:
    """Convert shishkabob-case (kebab-case) to camelCase."""
    parts = name.split('-')
    return parts[0] + ''.join(word.capitalize() for word in parts[1:]) if len(parts) > 1 else name


def shishkabob_to_snake(name: str) -> str:
    """Convert shishkabob-case (kebab-case) to snake_case."""
    return name.replace('-', '_')


def snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    parts = name.split('_')
    return parts[0] + ''.join(word.capitalize() for word in parts[1:]) if len(parts) > 1 else name


def snake_to_shishkabob(name: str) -> str:
    """Convert snake_case to shishkabob-case (kebab-case)."""
    return name.replace('_', '-')


def camel_to_shishkabob(name: str) -> str:
    """Convert camelCase or PascalCase to shishkabob-case (kebab-case)."""
    s1 = re.sub('(.)([A-Z][a-z]+)', r'\1-\2', name)
    return re.sub('([a-z0-9])([A-Z])', r'\1-\2', s1).lower()


def convert_to_snake(name: str) -> str:
    """
    Convert any string (camelCase, PascalCase, snake_case, shishkabob-case) to snake_case.
    """
    if '-' in name:
        # shishkabob-case to snake_case
        name = shishkabob_to_snake(name)
    # Now handle camelCase or PascalCase to snake_case
    if any(c.isupper() for c in name):
        name = camel_to_snake(name)
    # If already snake_case, return as is
    return name
