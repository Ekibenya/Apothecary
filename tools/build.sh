#!/bin/sh
# 单档卡：三维引擎退役，绘卷（官网立绘 VN）内嵌，出一张自包含卡。
# 用法：sh tools/build.sh [版本号]
set -e
cd "$(dirname "$0")/.."
VER="${1:-1}"
export ROMA_LINE=luzhi ROMA_CARD_BASE=luzhi ROMA_VER="$VER" ROMA_TITLE=薬屋のひとりごと
export ROMA_CDN=https://cdn.jsdelivr.net/gh/ekibenya/apothecary@main/

python3 tools/cardbuild.py
python3 tools/stcard.py
python3 tools/stfront.py
python3 tools/stpng.py st/cover.png st/luzhi.card.json st/luzhi.card.png

ls -la st/*.png
