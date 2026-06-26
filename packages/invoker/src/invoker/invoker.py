import importlib
import importlib.util

def invoker(module_name, function_name, parameters=None):
    """
    Dynamically invoke a function from a specified module.

    Args:
        module_name (str): The name of the module to import.
        function_name (str): The name of the function to call.
        parameters (list, optional): A list of parameters to pass to the function.

    Returns:
        The result of the function call.
    """
    module = importlib.import_module(module_name)
    func = getattr(module, function_name)
    if parameters is None:
        return func()
    else:
        return func(*parameters)

def module_function_exists(module_name, function_name):
    """
    Check whether a module and a function within that module exist.

    Args:
        module_name (str): The name of the module.
        function_name (str): The name of the function.

    Returns:
        bool: True if the module exists and contains the function, False otherwise.
    """
    spec = importlib.util.find_spec(module_name)
    if spec is None:
        return False
    module = importlib.import_module(module_name)
    return hasattr(module, function_name)

def safe_invoke(module_name, function_name, parameters=None):
    """
    Safely invoke a function by checking if the module and function exist.

    Args:
        module_name (str): The name of the module.
        function_name (str): The name of the function.
        parameters (list, optional): A list of parameters to pass to the function.

    Returns:
        The result of the function call if successful, or None if the module or function does not exist.
    """
    if not module_function_exists(module_name, function_name):
        print(f"Module '{module_name}' or function '{function_name}' not found.")
        return None
    return invoker(module_name, function_name, parameters)
