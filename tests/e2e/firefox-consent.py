#!/usr/bin/env python3
"""Real Firefox permission/consent prompts with an unmodified extension and a synthetic host.

Run under Xvfb. Firefox's browser UI is activated by xdotool; WebDriver's chrome
context is used only to locate the actual Allow/Deny buttons. The native host is a
clearly marked local test double: this checks UI, gating and permission revocation,
not physical BLE or interoperability with a second real device.
"""
import json, os, subprocess, tempfile, uuid
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from firefox import ROOT, FIREFOX, GECKO, start_site, wait, click, fill, toast, closed, message

def permission_ui(d, decision, expected):
    """Read the visible native Firefox popup, then click its real button in X11."""
    with d.context(d.CONTEXT_CHROME):
        WebDriverWait(d,15).until(lambda x:x.execute_script('let p=document.getElementById("notification-popup");return p&&p.state==="open";'))
        info=d.execute_script('''let n=document.getElementById("addon-webext-permissions-notification");
          if(!n) return null; let b=arguments[0]==='allow'?n.button:n.secondaryButton, r=b.getBoundingClientRect();
          return {text:n.textContent,x:Math.round(window.mozInnerScreenX+r.left+r.width/2),y:Math.round(window.mozInnerScreenY+r.top+r.height/2)};''',decision)
        assert info and expected.lower() in info['text'].lower(),info
    subprocess.run(['xdotool','mousemove','--sync',str(info['x']),str(info['y']),'click','1'],check=True)

def permission_data(d):
    return d.execute_async_script('const done=arguments[arguments.length-1];browser.permissions.getAll().then(done,e=>done({error:String(e)}));')

def main():
    server, origin=start_site(); d=None
    try:
        with tempfile.TemporaryDirectory(prefix='ghoststate-firefox-consent-') as td:
            home=Path(td); hostdir=home/'.mozilla/native-messaging-hosts';hostdir.mkdir(parents=True)
            host={'name':'com.ghoststate.bridge','description':'Synthetic Firefox consent test double','path':str(ROOT/'tests/e2e/fixtures/mock-native-host.py'),'type':'stdio','allowed_extensions':['ghoststate@local.invalid']}
            (hostdir/'com.ghoststate.bridge.json').write_text(json.dumps(host))
            uid=str(uuid.uuid4());opts=Options();opts.binary_location=FIREFOX;opts.set_preference('extensions.webextensions.uuids',json.dumps({'ghoststate@local.invalid':uid}))
            env=os.environ.copy();env['HOME']=str(home);env['MOZ_REMOTE_ALLOW_SYSTEM_ACCESS']='1'
            d=webdriver.Firefox(options=opts,service=Service(executable_path=GECKO,env=env,log_output=str(home/'geckodriver.log')))
            d.install_web_extension(str(ROOT/'release/firefox'),permanent=False)
            d.get(origin+'/login')
            with d.context(d.CONTEXT_CHROME):d.execute_script('gBrowser.selectedTab=gBrowser.addTrustedTab(arguments[0]);',f'moz-extension://{uid}/dashboard.html')
            d.switch_to.window(d.window_handles[-1]);wait(d,'h1')
            click(d,'button[data-action="unlock"]');fill(d,'#passphrase','synthetic master passphrase');fill(d,'#confirm-pass','synthetic master passphrase');click(d,'form button[type="submit"]');toast(d,'Your encrypted vault is ready.');closed(d)
            click(d,'button[data-action="add-profile"]');fill(d,'#label','Mock profile');fill(d,'#url','https://example.test');fill(d,'#username','test-user');fill(d,'#password','test-password');click(d,'form button[type="submit"]');toast(d,'Portal profile saved locally.');closed(d)
            click(d,'button[data-screen="workflows"]');click(d,'button[data-action="select-site"]');fill(d,'#site-url',origin);click(d,'form button[type="submit"]');permission_ui(d,'allow','127.0.0.1');toast(d,'Selected '+origin);closed(d)
            print('PASS real Firefox optional site-permission prompt on unmodified package')
            click(d,'button[data-screen="devices"]');click(d,'button[data-action="connect-native"]');permission_ui(d,'allow','program');toast(d,'Companion connected.')
            print('PASS real Firefox optional native-messaging permission prompt (synthetic host)')
            assert 'authenticationInfo' not in permission_data(d).get('data_collection',[])
            click(d,'button[data-action="send-profile"][data-id="synthetic-peer"]');click(d,'form button[type="submit"]');permission_ui(d,'deny','authentication')
            WebDriverWait(d,10).until(lambda x:'not granted' in x.find_element(By.CSS_SELECTOR,'.dialog .error').text.lower())
            assert not (home/'mock-send-count').exists(), 'Credential reached the mock despite denial'
            print('PASS real Firefox authentication-info consent denied: no credential was sent')
            click(d,'form button[type="submit"]');permission_ui(d,'allow','authentication');toast(d,'Encrypted transfer sent');closed(d)
            assert (home/'mock-send-count').read_text()=='1';assert 'authenticationInfo' in permission_data(d)['data_collection']
            print('PASS real Firefox authentication-info consent allowed: synthetic transfer reached mock')
            click(d,'button[data-action="send-profile"][data-id="synthetic-peer-2"]');click(d,'form button[type="submit"]');toast(d,'Encrypted transfer sent');closed(d)
            assert (home/'mock-send-count').read_text()=='2'
            assert (home/'mock-routed-peers').read_text().splitlines()==['synthetic-peer','synthetic-peer-2']
            print('PASS two independently selected recipients; synthetic transfers routed individually (mock, not BLE)')
            click(d,'button[data-action="accept-transfer"]');fill(d,'#transfer-label','Incoming mock');click(d,'form button[type="submit"]');toast(d,'Credential saved in your local vault.');closed(d)
            print('PASS synthetic incoming credential saved only after review and consent')
            removed=d.execute_async_script('const done=arguments[arguments.length-1];browser.permissions.remove({data_collection:["authenticationInfo"]}).then(done,e=>done(String(e)));');assert removed is True,removed
            profiles=message(d,'LIST_PROFILES');pid=next(p['id'] for p in profiles['data'] if p['origin']=='https://example.test')
            blocked=message(d,'NATIVE_SEND_PROFILE',{'id':pid,'origin':'https://example.test','peerId':'synthetic-peer'});assert not blocked['ok'] and 'consent' in blocked['error'].lower(),blocked
            assert (home/'mock-send-count').read_text()=='2'
            print('PASS Firefox background blocks transfer after data-collection consent revoked')
    finally:
        if d:
            try:d.quit()
            except Exception:pass
        server.shutdown();server.server_close()

if __name__=='__main__':main()
