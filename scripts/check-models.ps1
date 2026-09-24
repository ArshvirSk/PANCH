$ErrorActionPreference = "Stop"

$Models = @(
  "amazon.nova-pro-v1:0",
  "mistral.mistral-large-3-675b-instruct",
  "us.meta.llama3-3-70b-instruct-v1:0"
)

$plainMsg = "[{`"role`":`"user`",`"content`":[{`"text`":`"Reply with the word OK`"}]}]"
$plainMsg | Out-File -Encoding utf8 "plain.json"

$toolCfg = "{`"tools`":[{`"toolSpec`":{`"name`":`"test`",`"description`":`"test`",`"inputSchema`":{`"json`":{`"type`":`"object`",`"properties`":{`"x`":{`"type`":`"string`"}},`"required`":[`"x`"]}}}}],`"toolChoice`":{`"tool`":{`"name`":`"test`"}}}"
$toolCfg | Out-File -Encoding utf8 "toolcfg.json"

$toolMsg = "[{`"role`":`"user`",`"content`":[{`"text`":`"What is 2+2? Use the test tool.`"}]}]"
$toolMsg | Out-File -Encoding utf8 "toolmsg.json"

$jsonMsg = "[{`"role`":`"user`",`"content`":[{`"text`":`"Return {\`"answer\`":\`"yes\`",\`"score\`":10} exactly.`"}]}]"
$jsonMsg | Out-File -Encoding utf8 "jsonmsg.json"

foreach ($m in $Models) {
    Write-Host "--- Testing $m ---"
    Write-Host "Plain prompt:"
    aws bedrock-runtime converse --model-id $m --messages file://plain.json
    
    if ($m -eq "us.meta.llama3-3-70b-instruct-v1:0") {
        Write-Host "Tool use (Skipping toolChoice for Llama, testing JSON plain output instead):"
        aws bedrock-runtime converse --model-id $m --messages file://jsonmsg.json
    } else {
        Write-Host "Tool use:"
        aws bedrock-runtime converse --model-id $m --messages file://toolmsg.json --tool-config file://toolcfg.json
    }
    Write-Host ""
}

Remove-Item plain.json, toolcfg.json, toolmsg.json, jsonmsg.json -ErrorAction SilentlyContinue
