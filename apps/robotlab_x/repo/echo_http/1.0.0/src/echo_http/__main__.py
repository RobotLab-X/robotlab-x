"""CLI entrypoint: `python -m echo_http --port <PORT>`.

Kept dead-simple — argparse, then handed straight to uvicorn. We log to
stdout in a single line per record so the process_manager's stdout
pump produces clean log entries on the bus.
"""

import argparse
import logging

import uvicorn

from echo_http import app


def main() -> None:
    parser = argparse.ArgumentParser(description="Tiny FastAPI echo service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logging.getLogger("echo_http").info(
        "starting echo_http on http://%s:%d", args.host, args.port
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
