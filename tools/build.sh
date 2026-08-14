#!/bin/sh
# 三档卡：lite（纯文字）／std（三维，去现代包）／full（全带）。
# 用法：sh tools/build.sh [版本号]
set -e
cd "$(dirname "$0")/.."
VER="${1:-1}"
export ROMA_LINE=luzhi ROMA_CARD_BASE=luzhi ROMA_VER="$VER" ROMA_TITLE=雀斑之下
export ROMA_CDN=https://cdn.jsdelivr.net/gh/ekibenya/apothecary@main/

python3 tools/cardbuild.py
python3 tools/stcard.py

echo "── lite ──────────────────────────────"
ROMA_NO3D=1 python3 tools/stfront.py
python3 tools/stpng.py st/cover.png st/luzhi.card.json st/luzhi.card.lite.png

echo "── std ───────────────────────────────"
ROMA_PNG_ASSETS=1 ROMA_EMBED_ZHOU=1 ROMA_SKIP_MODERN=1 python3 tools/stfront.py
ROMA_PNG_DIR=st/pngassets python3 tools/stpng.py st/cover.png st/luzhi.card.json st/luzhi.card.png

echo "── full ──────────────────────────────"
ROMA_PNG_ASSETS=1 ROMA_EMBED_ZHOU=1 python3 tools/stfront.py
ROMA_PNG_DIR=st/pngassets python3 tools/stpng.py st/cover.png st/luzhi.card.json st/luzhi.card.full.png

ls -la st/*.png
