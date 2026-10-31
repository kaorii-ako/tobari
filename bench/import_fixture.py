"""Fake Chromium and Firefox profiles for bench/import_test.sh: python3 bench/import_fixture.py HOME"""
import json, os, sqlite3, sys

home = sys.argv[1]
chrome = os.path.join(home, ".config/chromium/Default")
os.makedirs(chrome)
json.dump({"roots": {"bookmark_bar": {"type": "folder", "children": [
    {"type": "url", "name": "Chromium mark", "url": "https://chromium-mark.example/"},
    {"type": "folder", "name": "Nested", "children": [
        {"type": "url", "name": "ไทย mark", "url": "https://thai-mark.example/"},
        {"type": "url", "name": "Script", "url": "javascript:alert(1)"}]}]}}},
    open(os.path.join(chrome, "Bookmarks"), "w"))
db = sqlite3.connect(os.path.join(chrome, "History"))
db.execute("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER)")
# Chromium time: microseconds since 1601-01-01. 13400000000000000 is 2025-08-23.
db.execute("INSERT INTO urls VALUES (1, 'https://chromium-visit.example/', 'Chromium visit', 7, 13400000000000000)")
db.execute("INSERT INTO urls VALUES (2, 'file:///etc/passwd', 'local file', 1, 13400000000000000)")
db.commit()

ff = os.path.join(home, ".mozilla/firefox/abc.default-release")
os.makedirs(ff)
db = sqlite3.connect(os.path.join(ff, "places.sqlite"))
db.execute("CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_date INTEGER)")
db.execute("CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, title TEXT)")
db.execute("INSERT INTO moz_places VALUES (1, 'https://firefox-visit.example/', 'Firefox visit', 3, 1750000000000000)")
db.execute("INSERT INTO moz_places VALUES (2, 'https://firefox-mark.example/', 'Firefox mark page', 0, NULL)")
db.execute("INSERT INTO moz_bookmarks VALUES (1, 1, 2, 'Firefox mark')")
db.commit()
