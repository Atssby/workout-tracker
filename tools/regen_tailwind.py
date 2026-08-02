#!/usr/bin/env python3
"""docs/tailwind.css を再生成するための補助スクリプト（Mac / Windows 共通）。

背景
----
本番で cdn.tailwindcss.com（Play CDN）は使えない。Tailwind 公式が
「The Play CDN is designed for development purposes only, and is not intended for
production.」と明記しており、実際 Service Worker のキャッシュ対象にもならないため
オフラインで画面が崩れる。そこで、このアプリが使うクラスぶんだけの CSS を
自己ホストしている（docs/tailwind.css）。

このマシンには Node が入っていないため Tailwind CLI が使えない。代わりに
「Play CDN に必要なクラスを食わせて、生成された CSS を取り出す」方式で作る。

使い方
------
1) このスクリプトを実行して生成用ページを作る:

       python tools/regen_tailwind.py            # Windows
       python3 tools/regen_tailwind.py           # Mac

   → <tmp>/twgen/index.html が出力される（パスは実行時に表示される）

2) そのフォルダを適当なローカルサーバで開く:

       python -m http.server 8101 --directory <tmp>/twgen

3) ブラウザの DevTools コンソールで次を実行し、出力を docs/tailwind.css に保存する:

       copy([...document.styleSheets].flatMap(s => {
         try { return [...s.cssRules].map(r => r.cssText); } catch { return []; }
       }).join('\n'))

4) docs/sw.js の CACHE_NAME を1つ上げる（キャッシュ更新のため）

注意
----
- クラスを追加・変更したら必ず再生成する。生成し忘れると、そのクラスだけ
  スタイルが当たらない（例: 凡例の色見本が消える、という形で出る）。
- docs/tailwind.css は生成物。手で編集しない。
"""

import re
import pathlib
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# index.html から削除済みなのでここに持つ（自己ホスト前の tailwind.config と同内容）
TAILWIND_CONFIG = """tailwind.config = { darkMode: 'class', theme: { extend: { colors: { indigo: {
  400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' } } } } }"""

TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9:_\-\./\[\]%()#,]*")
SKIP = ("http", "./", "https", "firebase", ".js", ".json", ".png", ".svg", ".html")


def collect_tokens() -> list:
    """index.html と app.js から、Tailwind クラスになりうる文字列を集める。

    過剰に拾っても Tailwind 側が無視するだけなので、取りこぼさない方に倒す。
    """
    tokens = set()

    def add(chunk: str) -> None:
        for t in chunk.split():
            t = t.strip("\"'`;,()=")          # 末尾の引用符を落とす（`rounded-sm"` 対策）
            if 1 <= len(t) <= 48 and TOKEN_RE.fullmatch(t):
                tokens.add(t)

    for name in ("index.html", "app.js"):
        src = (DOCS / name).read_text(encoding="utf-8")
        # 文字列リテラル（" ' ` すべて）
        for m in re.finditer(r'"([^"\n]*)"|\'([^\'\n]*)\'|`([^`]*)`', src, re.S):
            add(m.group(1) or m.group(2) or m.group(3) or "")
        # class 属性
        for m in re.finditer(r'class=\\?"([^"]*)\\?"', src):
            add(m.group(1))
        # classList.add/remove/toggle/replace
        for m in re.finditer(r"classList\.(?:add|remove|toggle|replace)\(([^)]*)\)", src):
            add(m.group(1).replace(",", " "))

    return sorted(t for t in tokens if not any(b in t for b in SKIP))


def main() -> None:
    tokens = collect_tokens()
    outdir = pathlib.Path(tempfile.gettempdir()) / "twgen"
    outdir.mkdir(parents=True, exist_ok=True)
    safelist = " ".join(tokens)

    page = (
        '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">\n'
        '<script src="https://cdn.tailwindcss.com"></script>\n'
        f"<script>{TAILWIND_CONFIG}</script>\n"
        "</head>\n"
        '<body class="light-mode">\n'
        f'<div class="{safelist}"></div>\n'
        f'<div class="dark"><div class="{safelist}"></div></div>\n'
        "</body></html>\n"
    )
    (outdir / "index.html").write_text(page, encoding="utf-8")

    print(f"tokens collected : {len(tokens)}")
    print(f"generator page   : {outdir / 'index.html'}")
    print()
    print("次の手順:")
    print(f'  python -m http.server 8101 --directory "{outdir}"')
    print("  ブラウザで http://localhost:8101 を開き、コンソールで:")
    print("    copy([...document.styleSheets].flatMap(s => {")
    print("      try { return [...s.cssRules].map(r => r.cssText); } catch { return []; }")
    print("    }).join('\\n'))")
    print(f'  クリップボードの内容を "{DOCS / "tailwind.css"}" に保存')
    print("  docs/sw.js の CACHE_NAME を1つ上げる")


if __name__ == "__main__":
    main()
