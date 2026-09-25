#!/usr/bin/env bash
# Grava a URL do servidor da IA em web/config.js (usado pelo CI).
set -euo pipefail
url="${1:-}"
if [ -z "$url" ]; then
  echo "ZENY_SERVER_URL não definida: app vai usar só o modo local."
  exit 0
fi
sed -i "s#serverUrl: '[^']*'#serverUrl: '${url}'#" web/config.js
echo "Servidor da IA: ${url}"
