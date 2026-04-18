#!/bin/bash
# Catalyst v3.0 — Просмотр логов

if command -v docker-compose &> /dev/null; then
  docker-compose logs -f "$@"
else
  tail -f logs/catalyst.log
fi
