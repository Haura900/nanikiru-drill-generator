from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS), **kwargs)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 18765), Handler)
    url = "http://127.0.0.1:18765/"
    print(f"起動中: {url}")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
