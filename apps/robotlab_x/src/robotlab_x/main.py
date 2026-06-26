# managed
import logging
import json
import asyncio
import argparse
import os
import sys
from config import create_app_settings
from robotlab_x.models.config import Config as RobotlabXConfig
from robotlab_x.pipeline import Pipeline
from robotlab_x.server import AppServer
from robotlab_x.event_handlers import on_startup, on_shutdown
from dotenv import load_dotenv

print(' '.join(sys.argv))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

VERSION_FILE = "version.json"

def load_version():
    """Load the version from version.json safely (synchronous, simple)."""
    try:
        if os.path.exists(VERSION_FILE):
            with open(VERSION_FILE, "r") as f:
                return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning(f"Error loading version.json: {e}")
    return {"version": "0.0.0"}


def parse_args():
    """Parse CLI args synchronously."""
    parser = argparse.ArgumentParser(description="AI Core Main")
    parser.add_argument("--env_file", default=".env", help="Path to the .env file (default: .env)")
    args = parser.parse_args()
    logger.info(f"VIRTUAL_ENV: {os.environ.get('VIRTUAL_ENV', '(not set)')}")
    logger.info(f"PYTHONPATH: {os.environ.get('PYTHONPATH', '(not set)')}")
    # Diagnostics: Check if env file exists
    if os.path.exists(args.env_file):
        logger.info(f"Env file found: {args.env_file}")
    else:
        logger.warning(f"Env file NOT found: {args.env_file}")
    return args

# load version at import time for simple, synchronous flow
version = load_version()
logger.info(f"Loaded version: {version}")

async def run():

    args = parse_args()
    env_file_keys = set()
    env_file_path = args.env_file if hasattr(args, 'env_file') else '.env'
    env_file_values = {}

    # Record env vars present before loading .env
    pre_dotenv_env = dict(os.environ)

    # Load .env file
    if os.path.exists(env_file_path):
        load_dotenv(env_file_path)
        with open(env_file_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    env_file_keys.add(key.strip())
                    env_file_values[key.strip()] = val.strip()

    settings, _ = create_app_settings("robotlab_x", RobotlabXConfig, env_file=args.env_file)
    settings: RobotlabXConfig = settings

    # Set log level for both root logger and module logger
    log_level = settings.log_level or logging.INFO
    logging.info("Setting log level to %s", log_level)
    logging.getLogger().setLevel(log_level)
    logger.setLevel(log_level)
    logger.debug("Debug logging enabled at level: %s", log_level)


    # Diagnostics: Log config source for each setting - removed to avoid logging sensitive config values
    # logger.info("Configuration diagnostics:")
    # for field, value in settings.model_dump().items():
    #     env_var_name = f"HYRULE_API_{field.upper()}"
    #     config_val_str = str(value).strip()
    #     pre_dotenv_val = pre_dotenv_env.get(env_var_name)
    #     pre_dotenv_val_str = str(pre_dotenv_val).strip() if pre_dotenv_val is not None else None
    #     env_file_val = env_file_values.get(env_var_name)
    #     env_file_val_str = str(env_file_val).strip() if env_file_val is not None else None
    #     # Only consider env var as 'set by env' if present before .env loaded and matches config value
    #     if pre_dotenv_val is not None and config_val_str == pre_dotenv_val_str:
    #         logger.info(f"{field}: set by env ({config_val_str}) [env={pre_dotenv_val_str}]")
    #     # If env var was NOT present before .env, but value matches .env file, log 'set by file'
    #     elif env_file_val is not None and config_val_str == env_file_val_str:
    #         logger.info(f"{field}: set by file ({config_val_str}) [file={env_file_val_str}]")
    #     elif env_file_val is not None:
    #         logger.info(f"{field}: set by file ({config_val_str}) [file={env_file_val_str}] (but overridden by default)")
    #     else:
    #         logger.info(f"{field}: using default ({config_val_str})")

    on_startup()

    components = []

    num_pipelines = settings.num_pipelines if hasattr(settings, "num_pipelines") else 1

    if num_pipelines >= 1:
        components.extend([Pipeline(settings) for _ in range(num_pipelines)])

    if settings.app_server_enabled:
        components.append(AppServer(settings))

    try:
        await asyncio.gather(*(comp.run() for comp in components))
    finally:
        for comp in components:
            stop = getattr(comp, "stop", None)
            if stop is None:
                continue
            try:
                result = stop()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("Error stopping component %s", comp.__class__.__name__)
        on_shutdown()

if __name__ == "__main__":
    asyncio.run(run())
