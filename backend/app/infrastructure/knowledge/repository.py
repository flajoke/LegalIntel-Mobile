from contextlib import contextmanager
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3


def split_document(text: str, max_chars: int = 2400) -> list[tuple[int, int, str]]:
    """Paragraph-aligned chunks; oversized paragraphs stay whole to preserve conditions."""
    spans = [(m.start(), m.end()) for m in re.finditer(r"\S(?:.*?\S)?(?=\n\n|\Z)", text, re.S)]
    result = []
    start = end = None
    for p_start, p_end in spans:
        if start is not None and p_end - start > max_chars:
            result.append((start, end, text[start:end]))
            start = None
        if start is None:
            start = p_start
        end = p_end
    if start is not None:
        result.append((start, end, text[start:end]))
    return result


class KnowledgeRepository:
    SCHEMA_VERSION = "1"

    def __init__(self, database: Path, corpus: Path):
        self.database = database
        self.corpus = corpus

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.database, timeout=20)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    def rebuild(self, force: bool = False) -> dict:
        manifest_bytes = (self.corpus / "manifest.json").read_bytes()
        manifest = json.loads(manifest_bytes)
        documents = []
        for item in manifest["documents"]:
            path = (self.corpus / item["file"]).resolve()
            if not path.is_relative_to(self.corpus.resolve()):
                raise ValueError("Corpus path escapes its directory")
            text = path.read_text(encoding="utf-8").strip()
            digest = sha256(text.encode()).hexdigest()
            if digest != item["sha256"] or not text:
                raise ValueError(f"Corpus checksum mismatch: {item['id']}")
            documents.append((item, text))
        fingerprint = sha256(manifest_bytes + b"".join(text.encode() for _, text in documents)).hexdigest()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                previous = dict(connection.execute("SELECT key,value FROM metadata"))
                if previous.get("schema_version", self.SCHEMA_VERSION) != self.SCHEMA_VERSION:
                    raise ValueError("Unsupported knowledge database version")
                if not force and previous.get("fingerprint") == fingerprint:
                    connection.commit()
                    return self.status()
                # This DB contains the rebuildable legal index only, never user cases.
                for name in ("chunk_search", "chunks", "documents"):
                    connection.execute(f"DROP TABLE IF EXISTS {name}")
                connection.execute("CREATE TABLE documents (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, body TEXT NOT NULL)")
                connection.execute("CREATE TABLE chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), position INTEGER NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL, body TEXT NOT NULL)")
                connection.execute("CREATE VIRTUAL TABLE chunk_search USING fts5(chunk_id UNINDEXED, document_id UNINDEXED, title, body, keywords, tokenize='unicode61 remove_diacritics 2')")
                for item, text in documents:
                    connection.execute("INSERT INTO documents VALUES (?,?,?)", (item["id"], json.dumps(item, ensure_ascii=False), text))
                    for position, (start, end, chunk) in enumerate(split_document(text), 1):
                        chunk_id = f"{item['id']}:{position}"
                        connection.execute("INSERT INTO chunks VALUES (?,?,?,?,?,?)", (chunk_id, item["id"], position, start, end, chunk))
                        connection.execute("INSERT INTO chunk_search VALUES (?,?,?,?,?)", (chunk_id, item["id"], item["citation"] + " " + item["title"], chunk, " ".join(item["keywords"])))
                metadata = {"schema_version": self.SCHEMA_VERSION, "fingerprint": fingerprint,
                            "corpus_version": manifest["version"], "checked_on": manifest["checked_on"]}
                connection.executemany("INSERT OR REPLACE INTO metadata VALUES (?,?)", metadata.items())
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return self.status()

    def status(self) -> dict:
        with self.connection() as connection:
            meta = dict(connection.execute("SELECT key,value FROM metadata"))
            return {"version": meta["corpus_version"], "checked_on": meta["checked_on"],
                    "documents": connection.execute("SELECT count(*) FROM documents").fetchone()[0],
                    "chunks": connection.execute("SELECT count(*) FROM chunks").fetchone()[0]}

    @staticmethod
    def _source(row) -> dict:
        item = json.loads(row["metadata"])
        return {key: item[key] for key in ("id", "citation", "title", "source_url", "publisher", "edition", "checked_on", "source_type", "sha256")}

    def document(self, document_id: str) -> dict | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM documents WHERE id=?", (document_id,)).fetchone()
            if row is None:
                return None
            result = self._source(row)
            result["text"] = row["body"]
            result["chunks"] = [dict(r) for r in connection.execute(
                "SELECT id,position,start_offset,end_offset,body AS text FROM chunks WHERE document_id=? ORDER BY position", (document_id,))]
            return result

    def list_documents(self) -> list[dict]:
        with self.connection() as connection:
            return [self._source(row) for row in connection.execute("SELECT * FROM documents ORDER BY rowid")]

    def sources_for(self, answers: dict) -> list[dict]:
        ids = ["tk-136", "tk-236", "tk-392", "tk-352"]
        if answers.get("employment_type") == "unwritten":
            ids = ["tk-16", "tk-67"] + ids
        elif answers.get("employment_type") == "civil":
            ids = ["tk-19.1", "tk-16"] + ids
        if answers.get("payment_type") == "settlement":
            ids.insert(0, "tk-140")
        if answers.get("work_status") == "working":
            ids.append("tk-142")
        ids += ["tk-62", "tk-356", "koap-5.27", "uk-145.1"]
        with self.connection() as connection:
            result = []
            for document_id in dict.fromkeys(ids):
                row = connection.execute("SELECT d.metadata,c.id AS chunk_id,c.body FROM documents d JOIN chunks c ON c.document_id=d.id WHERE d.id=? ORDER BY c.position LIMIT 1", (document_id,)).fetchone()
                if row:
                    result.append({**self._source(row), "chunk_id": row["chunk_id"], "excerpt": row["body"][:420] + ("…" if len(row["body"]) > 420 else "")})
            return result

    def search(self, query: str, limit: int = 12) -> list[dict]:
        words = re.findall(r"[а-яёa-z0-9]+", query.casefold().replace("ё", "е"))[:16]
        stop = {"и", "в", "во", "на", "по", "за", "что", "как", "не", "мне", "для", "с", "со", "это"}
        words = [word for word in words if word not in stop]
        aliases = {
            "зарплат": ["заработн", "плат"], "задерж": ["срок", "невыплат"],
            "неплат": ["невыплат"], "неофициал": ["договор", "допущен"],
            "процент": ["компенсац"], "жалоб": ["инспекц", "защит"],
            "гпх": ["гражданско", "трудовыми"], "иск": ["суд", "обращен"],
        }
        terms = set(words)
        for word in words:
            if len(word) >= 5 and not word.isdigit():
                terms.add(word[:-2])
            for prefix, extra in aliases.items():
                if word.startswith(prefix):
                    terms.update(extra)
        if not terms:
            return []
        # Only tokenized literals enter MATCH; user-supplied FTS operators are never executed.
        match = " OR ".join('"' + term + '"*' for term in sorted(terms))
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT d.metadata,c.id AS chunk_id,c.body,c.position,bm25(chunk_search,0,0,5,1,2) AS rank "
                "FROM chunk_search JOIN chunks c ON c.id=chunk_search.chunk_id JOIN documents d ON d.id=c.document_id "
                "WHERE chunk_search MATCH ? ORDER BY rank,c.id LIMIT ?", (match, limit)).fetchall()
            return [{**self._source(row), "chunk_id": row["chunk_id"], "position": row["position"],
                     "excerpt": row["body"], "rank": row["rank"]} for row in rows]
