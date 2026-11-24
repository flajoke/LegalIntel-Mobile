"""Offline, reproducible legal index management: python -m app.knowledge."""
import argparse
import json

from app.api.dependencies import get_knowledge


def main():
    parser = argparse.ArgumentParser(description="LegalIntel legal knowledge index")
    parser.add_argument("command", choices=["reindex", "status", "search"])
    parser.add_argument("query", nargs="?")
    args = parser.parse_args()
    repository = get_knowledge()
    status = repository.rebuild(force=args.command == "reindex")
    if args.command == "search":
        if not args.query:
            parser.error("search requires a query")
        result = {"corpus": status, "results": repository.search(args.query)}
    else:
        result = status
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
