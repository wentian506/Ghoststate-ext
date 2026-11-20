#!/usr/bin/env bash
# Installs a single-user Chrome/Firefox native host and its exact caller allowlist.
set -euo pipefail
usage() { echo "Usage: $0 <chrome|chromium|edge|brave|opera|firefox|chrome-testing> <extension-id> <built-companion-path>" >&2; exit 2; }
[[ $# -eq 3 ]] || usage
browser="$1"; id="$2"; binary="$3"
[[ -f "$binary" ]] || { echo "Companion binary not found: $binary" >&2; exit 1; }
case "$browser" in
  firefox) [[ "$id" == "ghoststate@local.invalid" ]] || { echo "Firefox ID must match the built manifest." >&2; exit 1; }; caller="$id" ;;
  chrome|chromium|edge|brave|opera|chrome-testing) [[ "$id" =~ ^[a-p]{32}$ ]] || { echo "Expected a 32-character Chromium extension ID (a-p)." >&2; exit 1; }; caller="chrome-extension://$id/" ;;
  *) usage ;;
esac
os="$(uname -s)"
case "$os:$browser" in
  Linux:chrome) dir="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
  Linux:chromium) dir="$HOME/.config/chromium/NativeMessagingHosts" ;;
  Linux:edge) dir="$HOME/.config/microsoft-edge/NativeMessagingHosts" ;;
  Linux:brave) dir="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
  Linux:opera) dir="$HOME/.config/opera/NativeMessagingHosts" ;;
  Linux:chrome-testing) dir="$HOME/.config/google-chrome-for-testing/NativeMessagingHosts" ;;
  Linux:firefox) dir="$HOME/.mozilla/native-messaging-hosts" ;;
  Darwin:chrome) dir="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
  Darwin:chromium) dir="$HOME/Library/Application Support/Chromium/NativeMessagingHosts" ;;
  Darwin:edge) dir="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" ;;
  Darwin:brave) dir="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
  Darwin:opera) dir="$HOME/Library/Application Support/com.operasoftware.Opera/NativeMessagingHosts" ;;
  Darwin:firefox) dir="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts" ;;
  *) echo "Unsupported OS/browser combination; use the Windows PowerShell installer or docs." >&2; exit 1 ;;
esac
umask 077
mkdir -p "$HOME/.local/bin" "$HOME/.config/ghoststate" "$dir"
python3 - "$browser" "$caller" "$dir" "$binary" "$HOME/.local/bin/ghoststate-companion" <<'PY'
import json, os, re, shutil, sys, tempfile
from pathlib import Path
browser,caller,directory,source,dest=sys.argv[1:]
config=Path.home()/'.config/ghoststate/allowed-callers.json'
valid_origin=lambda x: isinstance(x,str) and re.fullmatch(r'chrome-extension://[a-p]{32}/',x) is not None
valid_caller=lambda x: valid_origin(x) or x=='ghoststate@local.invalid'
allowed=[]
if config.exists():
    obj=json.loads(config.read_text(encoding='utf-8'))
    if not isinstance(obj,dict) or set(obj)!={'allowed'} or not isinstance(obj['allowed'],list) or len(obj['allowed'])>20 or not all(valid_caller(x) for x in obj['allowed']):
        raise SystemExit('Invalid existing allowlist; inspect it before retrying')
    allowed=list(dict.fromkeys(obj['allowed']))
if caller not in allowed: allowed.append(caller)
if len(allowed)>20: raise SystemExit('Caller allowlist limit reached')
manifest={'name':'com.ghoststate.bridge','description':'GhostState experimental local Bluetooth companion','path':str(Path(dest).absolute()),'type':'stdio'}
key='allowed_extensions' if browser=='firefox' else 'allowed_origins'
out=Path(directory)/'com.ghoststate.bridge.json'
# Preserve prior exact IDs for this browser only, never add a manifest ID that
# was absent from the previously trusted executable allowlist.
prior=[]
if out.exists():
    existing=json.loads(out.read_text(encoding='utf-8'))
    prior=existing.get(key,[]) if isinstance(existing,dict) else None
    valid=lambda x: x=='ghoststate@local.invalid' if browser=='firefox' else valid_origin(x)
    if not isinstance(prior,list) or len(prior)>20 or not all(valid(x) and x in allowed for x in prior):
        raise SystemExit('Existing host manifest and caller allowlist disagree; inspect both before retrying')
callers=list(dict.fromkeys([*prior,caller]))
if len(callers)>20: raise SystemExit('Browser allowlist limit reached')
manifest[key]=callers
# Validate all inputs before modifying the installed executable. Staging in the
# destination directory makes replacement atomic and allows a running old host.
source=Path(source).resolve(); dest=Path(dest)
if dest.exists() and os.path.samefile(source,dest):
    os.chmod(dest,0o755)
else:
    fd,tmp=tempfile.mkstemp(prefix='.ghoststate-',dir=dest.parent);os.close(fd)
    try:
        shutil.copyfile(source,tmp);os.chmod(tmp,0o755);os.replace(tmp,dest)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def write_json_atomic(path,value):
    fd,tmp=tempfile.mkstemp(prefix='.ghoststate-',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(value,f,indent=2);f.write('\n')
        os.chmod(tmp,0o600);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
write_json_atomic(config,{'allowed':allowed})
write_json_atomic(out,manifest)
print('Installed native host manifest:',out)
print('Exact caller authorized:',caller)
PY
echo 'Restart the browser, open GhostState > Devices & transfer, and choose Connect companion.'
