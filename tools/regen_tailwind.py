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

# 先頭の "-" を許すこと。Tailwind の負値ユーティリティ（-mx-4 / -translate-x-1/2 など）は
# ハイフン始まりで、これを弾くと「そのクラスだけスタイルが当たらない」形で静かに壊れる。
TOKEN_RE = re.compile(r"-?[A-Za-z][A-Za-z0-9:_\-\./\[\]%()#,]*")
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


def used_classes() -> set:
    """class 属性・className・classList に実際に現れるクラス名だけを集める。

    生成漏れの検査に使う。collect_tokens() より厳しく、文字列リテラル全体は見ない。
    """
    out = set()

    def add(chunk: str) -> None:
        for t in chunk.split():
            t = t.strip("\"'`;,()=")
            if t and "${" not in t:
                out.add(t)

    for name in ("index.html", "app.js"):
        src = (DOCS / name).read_text(encoding="utf-8")
        for m in re.finditer(r'class=\\?"([^"]*)\\?"', src):
            add(m.group(1))
        for m in re.finditer(r"className\s*=\s*[`'\"]([^`'\"]*)[`'\"]", src):
            add(m.group(1))
        for m in re.finditer(r"classList\.(?:add|remove|toggle|replace)\(([^)]*)\)", src):
            add(m.group(1).replace(",", " ").replace("'", " ").replace('"', " "))
    return out


# アプリ独自のクラス（Tailwind ではないので CSS に無くて当然）
OWN_CLASS_RE = re.compile(
    r"^(page|active|dark|light-mode|is-fresh|np-key|num-input|numpad-active|numpad-open|"
    r"safe-top|safe-bottom|tab-bar|tab-btn|recharts-wrapper|toggle-icon|set-row|set-label|"
    r"set-weight|set-reps|sets-list|suggestion-card|exercise-name|entry-memo|history-view-btn|"
    r"muscle-btn|edit-muscle-btn|today-muscle-btn|save-card-btn|add-set-btn|remove-set-btn|"
    r"edit-saved-btn|edit-set-input|rest-add-btn|edit-entry-btn|delete-entry-btn|"
    r"remove-edit-set-btn)$"
)


def looks_like_tailwind(t: str) -> bool:
    """Tailwind のクラス名になりうる形かどうか。

    class 属性の中には三項演算子の変数名（isDark）やプロパティ参照（numpad.fresh）が
    混ざるので、それらを除いて誤検知を減らす。
    - Tailwind のクラスは常に小文字（camelCase は JS の識別子）
    - ドットは 2.5 のように数字に挟まれる形しか出てこない
    """
    if any(c.isupper() for c in t):
        return False
    for i, c in enumerate(t):
        if c == ".":
            prev_ok = i > 0 and t[i - 1].isdigit()
            next_ok = i + 1 < len(t) and t[i + 1].isdigit()
            if not (prev_ok and next_ok):
                return False
    return True


def check() -> int:
    """使われているのに tailwind.css に無いクラスを報告する。終了コード1で失敗。"""
    css = (DOCS / "tailwind.css").read_text(encoding="utf-8")

    def selector(t: str) -> str:
        return "." + re.sub(r"([:\./\[\]%()#,])", r"\\\1", t)

    missing = []
    for t in sorted(used_classes()):
        if OWN_CLASS_RE.match(t) or not TOKEN_RE.fullmatch(t) or not looks_like_tailwind(t):
            continue
        if selector(t) not in css:
            missing.append(t)

    if missing:
        print(f"NG: tailwind.css に無いクラスが {len(missing)} 件あります")
        for m in missing:
            print("   -", m)
        print("\n再生成してください: python3 tools/regen_tailwind.py")
        return 1
    print("OK: 使われているクラスはすべて tailwind.css に含まれています")
    return 0


def main() -> None:
    import sys
    if "--check" in sys.argv:
        raise SystemExit(check())

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
