# managed
import logging
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from config import get_settings
from robotlab_x.models.config import Config as RobotlabXConfig

logger = logging.getLogger(__name__)

async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all for 5xx server errors."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    settings: RobotlabXConfig = get_settings()
    debug_mode = getattr(settings, "debug", False)
    
    message = str(exc) if debug_mode else "An unexpected internal error occurred."
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": message}
    )

def _jsonable_errors(errors):
    """Make pydantic's validation-error payloads JSON-serializable.

    Pydantic puts the raw request input under err["input"] and may also
    stash an Exception object under err["ctx"]["error"] (e.g. a
    ValueError raised from a field_validator). JSONResponse can't
    serialise either; without this the 422 path explodes and the
    catch-all 500 handler kicks in — masking a validation problem as
    an "unexpected internal error."
    """
    out = []
    for err in errors:
        e = dict(err)
        if isinstance(e.get("input"), bytes):
            e["input"] = e["input"].decode("utf-8", errors="replace")
        ctx = e.get("ctx")
        if isinstance(ctx, dict):
            ctx = dict(ctx)
            if isinstance(ctx.get("error"), BaseException):
                ctx["error"] = str(ctx["error"])
            e["ctx"] = ctx
        out.append(e)
    return out


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Standardized 422 client errors."""
    logger.warning(f"Validation error: {exc.errors()}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": _jsonable_errors(exc.errors())}
    )

def setup_error_handlers(app):
    app.add_exception_handler(Exception, global_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
