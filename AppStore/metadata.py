#!/usr/bin/env python3
"""Turn AppStore/Listing.md into a fastlane `deliver` metadata folder:  python3 AppStore/metadata.py OUTDIR"""
import os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
md = open(os.path.join(here, 'Listing.md')).read()
out = sys.argv[1]
loc = os.path.join(out, 'en-US'); os.makedirs(loc, exist_ok=True)

def section(title):
    m = re.search(r'^## ' + re.escape(title) + r'[^\n]*\n(.*?)(?=^## |\Z)', md, re.S | re.M)
    return m.group(1).strip() if m else ''

def row(label):
    m = re.search(r'^\| \*\*' + re.escape(label) + r'\*\*[^|]*\| (.*?) \|$', md, re.M)
    return m.group(1).strip() if m else ''

def put(path, text):
    open(path, 'w').write(text.strip() + '\n'); print(os.path.relpath(path, out), len(text.strip()))

put(os.path.join(loc, 'name.txt'), row('Name'))
put(os.path.join(loc, 'subtitle.txt'), row('Subtitle'))
put(os.path.join(loc, 'promotional_text.txt'), section('Promotional text'))
put(os.path.join(loc, 'description.txt'), section('Description'))
put(os.path.join(loc, 'keywords.txt'), section('Keywords'))
put(os.path.join(loc, 'privacy_url.txt'), row('Privacy policy'))
put(os.path.join(loc, 'support_url.txt'), row('Support URL'))
put(os.path.join(loc, 'marketing_url.txt'), row('Marketing URL'))
put(os.path.join(out, 'copyright.txt'), row('Copyright'))
put(os.path.join(out, 'primary_category.txt'), row('Primary category').upper())
put(os.path.join(out, 'secondary_category.txt'), row('Secondary category').upper())
rv = os.path.join(out, 'review_information'); os.makedirs(rv, exist_ok=True)
for k, v in {'first_name': 'Samuel', 'last_name': 'Ling', 'phone_number': '+1 718 857 5844',
             'email_address': 'samling@bu.edu', 'demo_user': '', 'demo_password': ''}.items():
    open(os.path.join(rv, k + '.txt'), 'w').write(v + '\n')
put(os.path.join(rv, 'notes.txt'), section('Review notes'))
lim = {'name.txt': 30, 'subtitle.txt': 30, 'promotional_text.txt': 170, 'keywords.txt': 100, 'description.txt': 4000}
for f, n in lim.items():
    t = open(os.path.join(loc, f)).read().strip()
    assert 0 < len(t) <= n, (f, len(t))
