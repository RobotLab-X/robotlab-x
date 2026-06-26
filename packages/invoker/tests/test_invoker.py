import pytest
from invoker import invoker, module_function_exists, safe_invoke


def test_invoker_with_parameters():
    result = invoker("math", "sqrt", [16])
    assert result == 4.0


def test_invoker_without_parameters():
    result = invoker("random", "random")
    assert isinstance(result, float)
    assert 0.0 <= result <= 1.0


def test_invoker_missing_module():
    with pytest.raises(ModuleNotFoundError):
        invoker("nonexistent_module", "func")


def test_invoker_missing_function():
    with pytest.raises(AttributeError):
        invoker("math", "nonexistent_function")


def test_module_function_exists_true():
    assert module_function_exists("math", "sqrt") is True


def test_module_function_exists_false_module():
    assert module_function_exists("nonexistent_module", "func") is False


def test_module_function_exists_false_function():
    assert module_function_exists("math", "nonexistent_function") is False


def test_safe_invoke_success():
    result = safe_invoke("math", "sqrt", [16])
    assert result == 4.0


def test_safe_invoke_missing_module():
    result = safe_invoke("nonexistent_module", "func")
    assert result is None


def test_safe_invoke_missing_function():
    result = safe_invoke("math", "nonexistent_function")
    assert result is None


def test_safe_invoke_without_parameters():
    result = safe_invoke("random", "random")
    assert isinstance(result, float)
    assert 0.0 <= result <= 1.0
