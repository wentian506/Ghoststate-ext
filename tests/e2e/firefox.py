#!/usr/bin/env python3
"""Synthetic Firefox WebDriver integration. See docs/INSTALLATION.md for prerequisites.

Uses a disposable copy of the manifest with localhost and native-messaging permissions
pregranted to avoid modal prompts during automated functional tests. The shipping manifest
remains optional-permission-only. No production accounts or external servers are used.
"""
from __future__ import annotations
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[2]
FIREFOX = os.environ.get('FIREFOX_BINARY', 'firefox')
GECKO = os.environ.get('GECKODRIVER', 'geckodriver')

class Site(BaseHTTPRequestHandler):
    def do_GET(self):
        step = 'password' if self.path.startswith('/password') else 'otp' if self.path.startswith('/otp') else 'email'
        form = {'email':'<input type="email" autocomplete="username" name="email"><button>Continue</button>',
                'password':'<input type="password" autocomplete="current-password" name="password"><button>Sign in</button>',
                'otp':'<input name="otp" autocomplete="one-time-code"><button>Verify</button>'}[step]
        next_path = '/password' if step == 'email' else '/otp'
        data = (f'<!doctype html><html><body><h1>Synthetic {step}</h1><form>{form}</form>'
                f'<script>document.querySelector("form").addEventListener("submit",e=>{{e.preventDefault();location.href="{next_path}"}})</script>'
                '</body></html>').encode()
        self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *_): pass

def start_site():
    s = ThreadingHTTPServer(('127.0.0.1',0),Site)
    threading.Thread(target=s.serve_forever,daemon=True).start()
    return s, f'http://127.0.0.1:{s.server_port}'

def wait(d, css, timeout=15):
    return WebDriverWait(d,timeout,ignored_exceptions=(StaleElementReferenceException,)).until(lambda x: next((e for e in x.find_elements(By.CSS_SELECTOR,css) if e.is_displayed()),False))
def click(d, css):
    # A state refresh can replace a control between lookup and the WebDriver
    # click command. Retry only stale references, not application failures.
    def action(x):
        for e in x.find_elements(By.CSS_SELECTOR,css):
            if e.is_displayed(): e.click(); return True
        return False
    WebDriverWait(d,15,ignored_exceptions=(StaleElementReferenceException,)).until(action)
def fill(d,css,value):
    def action(x):
        for e in x.find_elements(By.CSS_SELECTOR,css):
            if e.is_displayed(): e.clear(); e.send_keys(value); return True
        return False
    WebDriverWait(d,15,ignored_exceptions=(StaleElementReferenceException,)).until(action)
def toast(d,text):
    try:
        WebDriverWait(d,20).until(lambda x: text in x.find_element(By.CSS_SELECTOR,'#toast').get_attribute('textContent'))
    except Exception:
        print('Last dashboard message:', d.find_element(By.CSS_SELECTOR,'#toast').get_attribute('textContent'), file=sys.stderr)
        raise
def closed(d):
    WebDriverWait(d,20).until(lambda x: not x.find_elements(By.CSS_SELECTOR,'.dialog-backdrop'))
def text_contains(d,css,text,timeout=15):
    # Read and check in one browser operation; the dashboard can rerender
    # between WebDriver's separate element lookup and text commands.
    return WebDriverWait(d,timeout).until(lambda x:x.execute_script('const e=document.querySelector(arguments[0]);return !!e && e.textContent.includes(arguments[1]);',css,text))
def message(d,typ,payload=None):
    return d.execute_async_script('const done=arguments[arguments.length-1]; browser.runtime.sendMessage({type:arguments[0],payload:arguments[1]}).then(done,e=>done({error:String(e)}));',typ,payload or {})

def main():
    server, origin = start_site(); rogue, rogue_origin = start_site()
    driver = None
    try:
        with tempfile.TemporaryDirectory(prefix='ghoststate-firefox-e2e-') as tmp:
            tmp=Path(tmp); home=tmp/'home'; home.mkdir(); ext=tmp/'fixture-extension'
            shutil.copytree(ROOT/'release/firefox',ext)
            mpath=ext/'manifest.json'; manifest=json.loads(mpath.read_text()); manifest['host_permissions']=['http://127.0.0.1/*'];manifest['permissions'].append('nativeMessaging'); mpath.write_text(json.dumps(manifest))
            config=home/'.config/ghoststate'; config.mkdir(parents=True); (config/'allowed-callers.json').write_text(json.dumps({'allowed':['ghoststate@local.invalid']})); os.chmod(config/'allowed-callers.json',0o600)
            hostdir=home/'.mozilla/native-messaging-hosts';hostdir.mkdir(parents=True)
            host={'name':'com.ghoststate.bridge','description':'Synthetic test host','path':str(ROOT/'release/native-linux-x86_64/ghoststate-companion'),'type':'stdio','allowed_extensions':['ghoststate@local.invalid']}
            (hostdir/'com.ghoststate.bridge.json').write_text(json.dumps(host))
            uid=str(uuid.uuid4()); opts=Options();opts.binary_location=FIREFOX;opts.add_argument('-headless'); profile=tmp/'firefox-profile';profile.mkdir();opts.add_argument('-profile');opts.add_argument(str(profile))
            opts.set_preference('extensions.webextensions.uuids',json.dumps({'ghoststate@local.invalid':uid}))
            env=os.environ.copy();env['HOME']=str(home);env['MOZ_REMOTE_ALLOW_SYSTEM_ACCESS']='1'
            service=Service(executable_path=GECKO,env=env,log_output=str(tmp/'gecko.log'))
            driver=webdriver.Firefox(options=opts,service=service)
            driver.install_web_extension(str(ext),permanent=False)
            site=driver.current_window_handle;driver.get(origin+'/login')
            # WebDriver refuses direct moz-extension:// navigation; the browser's trusted UI can open it.
            with driver.context(driver.CONTEXT_CHROME):
                driver.execute_script('gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);',f'moz-extension://{uid}/dashboard.html')
            driver.switch_to.window(driver.window_handles[-1]);dashboard=driver.current_window_handle
            WebDriverWait(driver,20).until(lambda d: d.find_elements(By.CSS_SELECTOR,'h1'))
            assert driver.find_element(By.CSS_SELECTOR,'h1').text == 'Dashboard'
            assert driver.execute_script('return document.querySelector(".brand-mark img").naturalWidth > 0')
            click(driver,'button[data-action="unlock"]');fill(driver,'#passphrase','synthetic master passphrase');fill(driver,'#confirm-pass','synthetic master passphrase');click(driver,'form button[type="submit"]');toast(driver,'Your encrypted vault is ready.');closed(driver)
            click(driver,'button[data-action="add-profile"]');fill(driver,'#label','Synthetic Firefox portal');fill(driver,'#url',origin);fill(driver,'#username','synthetic@example.test');fill(driver,'#password','synthetic-password');click(driver,'form button[type="submit"]');toast(driver,'Portal profile saved locally.');closed(driver)
            click(driver,'button[data-screen="workflows"]');click(driver,'button[data-action="select-site"]');fill(driver,'#site-url',origin);click(driver,'form button[type="submit"]');toast(driver,'Selected '+origin);closed(driver)
            click(driver,'button[data-action="learn"]');click(driver,'form button[type="submit"]');closed(driver)
            text_contains(driver,'.list-main','1 state')
            driver.switch_to.window(site);fill(driver,'input','synthetic@example.test');click(driver,'form button');WebDriverWait(driver,10).until(lambda d:d.current_url.endswith('/password'))
            driver.switch_to.window(dashboard);click(driver,'button[data-action="learn"]');click(driver,'form button[type="submit"]');closed(driver);text_contains(driver,'.list-main','2 states')
            driver.switch_to.window(site);driver.get(origin+'/login');driver.switch_to.window(dashboard);click(driver,'button[data-action="fill"]');click(driver,'.dialog .accept');closed(driver)
            driver.switch_to.window(site);WebDriverWait(driver,10).until(lambda d:d.find_element(By.CSS_SELECTOR,'input').get_attribute('value')=='synthetic@example.test');click(driver,'form button');WebDriverWait(driver,10).until(lambda d:d.current_url.endswith('/password'))
            driver.switch_to.window(dashboard);click(driver,'button[data-action="fill"]');click(driver,'.dialog .accept');closed(driver)
            driver.switch_to.window(site);WebDriverWait(driver,10).until(lambda d:d.find_element(By.CSS_SELECTOR,'input').get_attribute('value')=='synthetic-password');assert driver.current_url.endswith('/password');click(driver,'form button');WebDriverWait(driver,10).until(lambda d:d.current_url.endswith('/otp'))
            driver.switch_to.window(dashboard);click(driver,'button[data-action="fill"]');toast(driver,'Complete otp manually');driver.switch_to.window(site);assert driver.find_element(By.CSS_SELECTOR,'input').get_attribute('value')==''
            print('PASS Firefox synthetic two-step learning/fill, manual submission and OTP pause')
            # The opt-in automatic flow still requires the selected top-level tab, exact
            # origin, learned states, a live unlocked vault and separate manual submits.
            driver.switch_to.window(site);driver.get(origin+'/login');driver.switch_to.window(dashboard)
            assert message(driver,'AUTO_STATUS')['data'] is None
            click(driver,'button[data-action="auto-enable"]');click(driver,'.dialog .accept');closed(driver)
            driver.switch_to.window(site);WebDriverWait(driver,15).until(lambda d:d.find_element(By.CSS_SELECTOR,'input').get_attribute('value')=='synthetic@example.test')
            assert driver.current_url.endswith('/login');click(driver,'form button');WebDriverWait(driver,10).until(lambda d:d.current_url.endswith('/password'))
            WebDriverWait(driver,15).until(lambda d:d.find_element(By.CSS_SELECTOR,'input').get_attribute('value')=='synthetic-password')
            assert driver.current_url.endswith('/password');click(driver,'form button');WebDriverWait(driver,10).until(lambda d:d.current_url.endswith('/otp'))
            time.sleep(1);assert driver.find_element(By.CSS_SELECTOR,'input').get_attribute('value')==''
            driver.switch_to.window(dashboard);click(driver,'button[data-action="auto-disable"]');assert message(driver,'AUTO_STATUS')['data'] is None
            print('PASS Firefox opt-in automatic fill of learned steps, manual submissions, OTP pause and disable')
            driver.switch_to.window(dashboard);profile_id=driver.find_element(By.CSS_SELECTOR,'button[data-action="fill"]').get_attribute('data-id');driver.switch_to.window(site);driver.get(rogue_origin+'/password');driver.switch_to.window(dashboard)
            blocked=message(driver,'FILL_STATE',{'id':profile_id});assert not blocked['ok'] and 'Origin mismatch' in blocked['error'],blocked
            driver.switch_to.window(site);assert driver.find_element(By.CSS_SELECTOR,'input').get_attribute('value')==''
            print('PASS Firefox exact-port origin isolation')
            driver.switch_to.window(dashboard);click(driver,'button[data-screen="devices"]');click(driver,'button[data-action="connect-native"]');toast(driver,'Companion connected.')
            native=message(driver,'NATIVE_REQUEST',{'op':'status'});assert native.get('ok') and native['data']['platform']=='linux',native
            print('PASS Firefox connected to the actual registered Rust native host')
            click(driver,'button[data-action="lock"]');toast(driver,'Vault locked.');click(driver,'button[data-action="unlock"]');fill(driver,'#passphrase','synthetic master passphrase');click(driver,'form button[type="submit"]');toast(driver,'Vault unlocked.');closed(driver);click(driver,'button[data-screen="workflows"]');text_contains(driver,'.list-main','2 states')
            print('PASS Firefox encrypted workflow persisted across lock/unlock')
            # Temporary add-ons must be reinstalled after restart; keep the same profile and add-on ID.
            driver.quit(); driver=None
            driver=webdriver.Firefox(options=opts,service=Service(executable_path=GECKO,env=env,log_output=str(tmp/'gecko-restart.log')))
            driver.install_web_extension(str(ext),permanent=False)
            with driver.context(driver.CONTEXT_CHROME):
                driver.execute_script('gBrowser.selectedTab = gBrowser.addTrustedTab(arguments[0]);',f'moz-extension://{uid}/dashboard.html')
            driver.switch_to.window(driver.window_handles[-1]);wait(driver,'h1');click(driver,'button[data-action="unlock"]');fill(driver,'#passphrase','synthetic master passphrase');click(driver,'form button[type="submit"]');toast(driver,'Vault unlocked.');closed(driver);click(driver,'button[data-screen="workflows"]');text_contains(driver,'.list-main','2 states')
            print('PASS Firefox encrypted workflow persisted across actual browser restart and temporary add-on reload')
    finally:
        if driver:
            try: driver.quit()
            except Exception: pass
        server.shutdown(); rogue.shutdown();server.server_close();rogue.server_close()

if __name__=='__main__': main()
