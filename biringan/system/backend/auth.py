from functools import wraps
from flask import session, jsonify

def role_required(*roles):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            if session.get("role") not in roles:
                return jsonify(error="Forbidden"), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator