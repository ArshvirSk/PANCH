#!/usr/bin/env bash
set -e

MODELS=(
  "amazon.nova-pro-v1:0"
  "mistral.mistral-large-3-675b-instruct"
  "us.meta.llama3-3-70b-instruct-v1:0"
)

cat << 'EOF' > plain.json
[{"role":"user","content":[{"text":"Reply with the word OK"}]}]
EOF

cat << 'EOF' > toolcfg.json
{"tools":[{"toolSpec":{"name":"test","description":"test","inputSchema":{"json":{"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}}}}],"toolChoice":{"tool":{"name":"test"}}}
EOF

cat << 'EOF' > toolmsg.json
[{"role":"user","content":[{"text":"What is 2+2? Use the test tool."}]}]
EOF

cat << 'EOF' > jsonmsg.json
[{"role":"user","content":[{"text":"Return {\"answer\":\"yes\",\"score\":10} exactly."}]}]
EOF

for m in "${MODELS[@]}"; do
  echo "--- Testing $m ---"
  echo "Plain prompt:"
  aws bedrock-runtime converse --model-id "$m" --messages file://plain.json || echo "FAILED"
  
  if [ "$m" = "us.meta.llama3-3-70b-instruct-v1:0" ]; then
    echo "Tool use (Skipping toolChoice for Llama, testing JSON plain output instead):"
    aws bedrock-runtime converse --model-id "$m" --messages file://jsonmsg.json || echo "FAILED"
  else
    echo "Tool use:"
    aws bedrock-runtime converse --model-id "$m" --messages file://toolmsg.json --tool-config file://toolcfg.json || echo "FAILED"
  fi
  echo ""
done

rm plain.json toolcfg.json toolmsg.json jsonmsg.json
