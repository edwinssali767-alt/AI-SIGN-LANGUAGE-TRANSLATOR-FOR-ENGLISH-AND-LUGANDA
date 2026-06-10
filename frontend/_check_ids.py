import re
js_ids = set(re.findall(r"getElementById\(['\"`](\w+)['\"`]\)", open("frontend/translator.js", encoding="utf-8").read()))
html_ids = set(re.findall(r"id=\"(\w+)\"", open("frontend/translator.html", encoding="utf-8").read()))
missing = sorted(js_ids - html_ids)
print()
print("Missing ids from HTML:", missing)
