from contextlib import contextmanager

from mysql.connector import pooling

import config

DB_CONFIG = {
    "host": config.DB_HOST,
    "user": config.DB_USER,
    "password": config.DB_PASSWORD,
    "database": config.DB_NAME,
}

_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="biri_pool", pool_size=5, pool_reset_session=True, **DB_CONFIG
        )
    return _pool


@contextmanager
def db():
    """Yield (connection, dict-cursor). Commits on success, rolls back on error."""
    conn = get_pool().get_connection()
    cur = conn.cursor(dictionary=True)
    try:
        yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def fetch_all(sql, params=None):
    with db() as (_, cur):
        cur.execute(sql, params or ())
        return cur.fetchall()


def fetch_one(sql, params=None):
    with db() as (_, cur):
        cur.execute(sql, params or ())
        return cur.fetchone()


def init_db():
    """Create the small extra table used for the dashboard's Recent Activity."""
    with db() as (_, cur):
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS activity_log (
                activity_id INT AUTO_INCREMENT PRIMARY KEY,
                message     VARCHAR(255) NOT NULL,
                created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def log_activity(cur, message):
    cur.execute("INSERT INTO activity_log (message) VALUES (%s)", (message[:255],))