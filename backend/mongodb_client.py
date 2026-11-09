"""MongoDB Atlas client with a SQLite fallback for local development."""

import sqlite3
import threading
from types import SimpleNamespace

from pymongo import MongoClient
from flask import current_app, g
import logging

logger = logging.getLogger(__name__)


SQLITE_SCHEMAS = {
    'users': '''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            password TEXT,
            auth_id TEXT UNIQUE,
            created_at TEXT,
            last_login_at TEXT,
            last_logout_at TEXT,
            is_online INTEGER DEFAULT 0,
            subscription_tier TEXT DEFAULT 'basic'
        )
    ''',
    'admin_users': '''
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            created_at TEXT,
            last_login_at TEXT
        )
    ''',
    'gestures': '''
        CREATE TABLE IF NOT EXISTS gestures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gesture_name TEXT UNIQUE,
            english_meaning TEXT,
            luganda_meaning TEXT,
            description TEXT,
            created_at TEXT
        )
    ''',
    'translations': '''
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            gesture_id TEXT,
            gesture TEXT,
            user_id TEXT,
            source_language TEXT,
            target_language TEXT,
            english_translation TEXT,
            luganda_translation TEXT,
            word TEXT,
            timestamp TEXT
        )
    ''',
    'letter_gestures': '''
        CREATE TABLE IF NOT EXISTS letter_gestures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            letter TEXT UNIQUE,
            gesture_name TEXT,
            description TEXT,
            created_at TEXT
        )
    ''',
    'tutorial_videos': '''
        CREATE TABLE IF NOT EXISTS tutorial_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            description TEXT,
            access_level TEXT DEFAULT 'free',
            order_index INTEGER DEFAULT 0,
            filename TEXT,
            url TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    '''
}


class SQLiteCursor(list):
    """Small chainable cursor facade for the collection methods used by the app."""

    def sort(self, key, direction=1):
        reverse = direction == -1
        sorted_rows = sorted(self, key=lambda item: item.get(key) or '', reverse=reverse)
        return SQLiteCursor(sorted_rows)

    def limit(self, amount):
        return SQLiteCursor(self[:amount])


class SQLiteCollection:
    """Tiny pymongo-like adapter used when MongoDB is not configured."""

    def __init__(self, table_name):
        self.table_name = table_name
        self._ensure_table()

    @property
    def connection(self):
        database_path = current_app.config['DATABASE']
        connection = getattr(g, '_sqlite_collection_db', None)
        if connection is None:
            connection = g._sqlite_collection_db = sqlite3.connect(database_path)
            connection.row_factory = sqlite3.Row
        return connection

    def _ensure_table(self):
        schema = SQLITE_SCHEMAS.get(self.table_name)
        if schema:
            self.connection.execute(schema)
            if self.table_name == 'users':
                columns = {
                    row['name']
                    for row in self.connection.execute('PRAGMA table_info(users)').fetchall()
                }
                if 'auth_id' not in columns:
                    self.connection.execute('ALTER TABLE users ADD COLUMN auth_id TEXT')
                self.connection.execute(
                    'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id)'
                )
            self.connection.commit()

    def create_index(self, *args, **kwargs):
        return None

    def count_documents(self, query=None):
        sql, values = self._build_where(query or {})
        row = self.connection.execute(
            f'SELECT COUNT(*) AS total FROM {self.table_name}{sql}',
            values,
        ).fetchone()
        return int(row['total'])

    def find_one(self, query=None):
        sql, values = self._build_where(query or {})
        row = self.connection.execute(
            f'SELECT * FROM {self.table_name}{sql} LIMIT 1',
            values,
        ).fetchone()
        return self._row_to_doc(row) if row else None

    def find(self, query=None):
        sql, values = self._build_where(query or {})
        rows = self.connection.execute(
            f'SELECT * FROM {self.table_name}{sql}',
            values,
        ).fetchall()
        return SQLiteCursor([self._row_to_doc(row) for row in rows])

    def insert_one(self, document):
        columns = []
        values = []
        for key, value in (document or {}).items():
            column = self._to_column(key)
            if column == 'id':
                continue
            columns.append(column)
            values.append(self._coerce_value(value))

        placeholders = ', '.join('?' for _ in columns)
        column_sql = ', '.join(columns)
        cursor = self.connection.execute(
            f'INSERT INTO {self.table_name} ({column_sql}) VALUES ({placeholders})',
            values,
        )
        self.connection.commit()
        return SimpleNamespace(inserted_id=cursor.lastrowid)

    def update_one(self, query, update):
        set_values = update.get('$set', update or {})
        assignments = []
        values = []
        for key, value in set_values.items():
            column = self._to_column(key)
            if column == 'id':
                continue
            assignments.append(f'{column} = ?')
            values.append(self._coerce_value(value))

        if not assignments:
            return SimpleNamespace(matched_count=0, modified_count=0)

        where_sql, where_values = self._build_where(query or {})
        cursor = self.connection.execute(
            f'UPDATE {self.table_name} SET {", ".join(assignments)}{where_sql}',
            values + where_values,
        )
        self.connection.commit()
        return SimpleNamespace(matched_count=cursor.rowcount, modified_count=cursor.rowcount)

    def delete_one(self, query):
        where_sql, values = self._build_where(query or {})
        cursor = self.connection.execute(
            f'DELETE FROM {self.table_name}{where_sql}',
            values,
        )
        self.connection.commit()
        return SimpleNamespace(deleted_count=min(cursor.rowcount, 1))

    def delete_many(self, query):
        where_sql, values = self._build_where(query or {})
        cursor = self.connection.execute(
            f'DELETE FROM {self.table_name}{where_sql}',
            values,
        )
        self.connection.commit()
        return SimpleNamespace(deleted_count=cursor.rowcount)

    def _build_where(self, query):
        if not query:
            return '', []

        clauses = []
        values = []
        for key, value in query.items():
            column = self._to_column(key)
            if isinstance(value, dict) and '$in' in value:
                in_values = [self._coerce_value(item, column) for item in value.get('$in', [])]
                if not in_values:
                    clauses.append('1 = 0')
                    continue
                placeholders = ', '.join('?' for _ in in_values)
                clauses.append(f'{column} IN ({placeholders})')
                values.extend(in_values)
                continue

            clauses.append(f'{column} = ?')
            values.append(self._coerce_value(value, column))

        return ' WHERE ' + ' AND '.join(clauses), values

    def _row_to_doc(self, row):
        document = dict(row)
        document['_id'] = document.pop('id')
        return document

    def _to_column(self, key):
        return 'id' if key == '_id' else key

    def _coerce_value(self, value, column=None):
        if column == 'id':
            try:
                return int(str(value))
            except (TypeError, ValueError):
                return -1
        return str(value) if value is not None and not isinstance(value, (int, float)) else value


def use_mongodb():
    """Return True when the app is configured to use MongoDB."""
    return bool(current_app.config.get('MONGODB_URI'))


def get_sqlite_collection(table_name):
    return SQLiteCollection(table_name)


_MONGO_CLIENT = None
_MONGO_CLIENT_URI = None
_MONGO_LOCK = threading.Lock()


def get_mongo_client():
    """Return the shared MongoClient (thread-safe, pooled, created once per process).

    Creating a client per request costs a DNS SRV lookup, TLS handshake and
    auth round-trip every time, which made every API call take several seconds.
    """
    global _MONGO_CLIENT, _MONGO_CLIENT_URI
    if not use_mongodb():
        raise ValueError("MONGODB_URI not configured")

    mongo_uri = current_app.config.get('MONGODB_URI')
    if not mongo_uri:
        raise ValueError("MONGODB_URI not configured")

    if _MONGO_CLIENT is None or _MONGO_CLIENT_URI != mongo_uri:
        with _MONGO_LOCK:
            if _MONGO_CLIENT is None or _MONGO_CLIENT_URI != mongo_uri:
                _MONGO_CLIENT = MongoClient(
                    mongo_uri,
                    maxPoolSize=20,
                    serverSelectionTimeoutMS=8000,
                    connectTimeoutMS=8000,
                )
                _MONGO_CLIENT_URI = mongo_uri
    return _MONGO_CLIENT


def get_mongo_db():
    """Get MongoDB database instance."""
    client = get_mongo_client()
    db_name = current_app.config.get('MONGODB_DB_NAME', 'sign_language_translator')
    return client[db_name]


def get_users_collection():
    """Get users collection."""
    if not use_mongodb():
        return get_sqlite_collection('users')

    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_USERS_COLLECTION', 'users')
    return db[collection_name]


def get_admins_collection():
    """Get admin users collection."""
    if not use_mongodb():
        return get_sqlite_collection('admin_users')

    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_ADMINS_COLLECTION', 'admin_users')
    return db[collection_name]


def get_gestures_collection():
    """Get gestures collection."""
    if not use_mongodb():
        return get_sqlite_collection('gestures')

    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_GESTURES_COLLECTION', 'gestures')
    return db[collection_name]


def get_translations_collection():
    """Get translations collection."""
    if not use_mongodb():
        return get_sqlite_collection('translations')

    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_TRANSLATIONS_COLLECTION', 'translations')
    return db[collection_name]


def get_letters_collection():
    """Get letter gestures collection."""
    if not use_mongodb():
        return get_sqlite_collection('letter_gestures')

    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_LETTERS_COLLECTION', 'letter_gestures')
    return db[collection_name]


def get_tutorials_collection():
    """Get tutorial videos collection."""
    if not use_mongodb():
        return get_sqlite_collection('tutorial_videos')

    db = get_mongo_db()
    collection_name = current_app.config.get('MONGODB_TUTORIALS_COLLECTION', 'tutorial_videos')
    return db[collection_name]


def close_mongo_client(error):
    """No-op: the shared MongoClient lives for the whole process."""
    return None


def init_mongodb_indexes():
    """Create indexes for MongoDB collections."""
    if not use_mongodb():
        for table_name in SQLITE_SCHEMAS:
            get_sqlite_collection(table_name)
        return

    db = get_mongo_db()
    
    # Users indexes
    users = get_users_collection()
    users.create_index('username', unique=True)
    users.create_index('email', unique=True)
    users.create_index('auth_id', unique=True, sparse=True)
    
    # Admin users indexes
    admin_users = get_admins_collection()
    admin_users.create_index('username', unique=True)
    
    # Gestures indexes
    gestures = get_gestures_collection()
    gestures.create_index('gesture_name', unique=True)
    
    # Translations indexes
    translations = get_translations_collection()
    translations.create_index([('user_id', 1), ('timestamp', -1)])
    
    # Letter gestures indexes
    letters = get_letters_collection()
    letters.create_index('letter', unique=True)

    tutorials = get_tutorials_collection()
    tutorials.create_index([('order_index', 1), ('created_at', -1)])
