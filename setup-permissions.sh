#!/bin/bash
# Script para configurar permissões do OpenCode para o Agent Orchestrator

echo "🔧 Configurando permissões do OpenCode..."

mkdir -p ~/.opencode

# Configuração com TODAS as permissões necessárias
PERMISSION_CONFIG='{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "allow",
    "read": "allow",
    "edit": "allow",
    "write": "allow",
    "bash": "allow",
    "websearch": "allow",
    "glob": "allow",
    "grep": "allow",
    "grepc": "allow",
    "file_watcher": "allow",
    "task": "allow"
  }
}'

echo "$PERMISSION_CONFIG" > ~/.opencode/opencode.json

echo "✅ Permissões configuradas!"
echo ""
echo "O OpenCode agora pode fazer TUDO:"
echo "  ✅ Ler arquivos"
echo "  ✅ Criar/editar arquivos"
echo "  ✅ Executar comandos bash"
echo "  ✅ Buscar/glob"
echo "  ✅ Tarefas (task agent)"
echo "  ✅ Pesquisar na web"
