"""Database package for SmartPark RTD MongoDB integration."""

from database.mongodb import (
    close_mongo_connection,
    connect_to_mongo,
    ensure_indexes_and_validators,
    get_database,
)
from database.schemas import COLLECTIONS, serialize_doc, serialize_list, to_object_id

__all__ = [
    "COLLECTIONS",
    "connect_to_mongo",
    "close_mongo_connection",
    "ensure_indexes_and_validators",
    "get_database",
    "serialize_doc",
    "serialize_list",
    "to_object_id",
]

