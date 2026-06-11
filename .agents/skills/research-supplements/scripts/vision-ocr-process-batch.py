#!/usr/bin/env python3
"""Reusable: collect OCR chunk outputs, anchor against factsText, build labels.mjs items.
Usage: process_ocr_batch.py <chunks_dir> <manifest.json> <out_items.json>
Excludes ids already written this session (tracked in ocr_written_ids.json)."""
import json, glob, re, unicodedata, sys, os, collections

chunks_dir, manifest_path, out_items = sys.argv[1], sys.argv[2], sys.argv[3]

def fold(s): return unicodedata.normalize('NFKD', str(s)).encode('ascii','ignore').decode().lower()
def evnums(ev):
    s=set()
    for m in re.finditer(r'\d+(?:[,. ]\d{3})*(?:[.,]\d+)?', ev):
        t=m.group(0); s|={t,t.replace(' ',''),re.sub(r'[, .](?=\d{3}\b)','',t),re.sub(r'[. ](?=\d{3}\b)','',t).replace(',','.')}
    for m in re.finditer(r'\d+', ev): s.add(m.group(0))
    return s

man={m['id']:m for m in json.load(open(manifest_path))}
written=set()
if os.path.exists('/tmp/murph-supplement-audit/ocr_written_ids.json'):
    written=set(json.load(open('/tmp/murph-supplement-audit/ocr_written_ids.json')))

out=[]
for f in sorted(glob.glob(f'{chunks_dir}/chunk_*_out.json')):
    try: out.extend(json.load(open(f)))
    except Exception: pass
seen=set(); dd=[]
for e in out:
    if isinstance(e,dict) and e.get('id') and e['id'] not in seen: seen.add(e['id']); dd.append(e)

ext=[e for e in dd if e.get('status')=='extracted' and e.get('ingredientRows')]
items=[]; anchor_fail=0; already=0
for e in ext:
    if e['id'] in written: already+=1; continue
    if e['id'] not in man: continue
    ev=fold(e.get('factsText','')); nums=evnums(ev)
    if not ev.strip(): anchor_fail+=1; continue
    bad=False
    for ir in e['ingredientRows']:
        toks=[t for t in fold(ir.get('name','')).split() if len(t)>2]
        if toks and not all(t in ev for t in toks): bad=True; break
        a=str(ir.get('amount','')).strip().lstrip('<>~')
        if a and a not in nums and a.replace(',','.') not in nums and a.replace(',','') not in nums: bad=True; break
    if bad: anchor_fail+=1; continue
    m=man[e['id']]; did=e['id']; src=did.split(':')[0]; sid=did.split(':',1)[1]
    items.append({"id":did,"dataOrigin":"brand_site","dataOriginId":did,"dataOriginUrl":m['url'],"source":src,"sourceId":sid,
        "name":m['name'],"brand":m['brand'],"upc":m['upc'],"offMarket":m['offMarket'],
        "label":{"source":src,"sourceId":sid,"sourceUrl":m['url'],"evidenceStatus":"vision_ocr_label_image",
            "factsText":e.get('factsText','')[:4000],"ingredientRows":e['ingredientRows'],
            **({"servingSizes":e['servingSizes']} if e.get('servingSizes') else {}),
            **({"otherIngredientRows":e['otherIngredientRows']} if e.get('otherIngredientRows') else {})}})
json.dump(items, open(out_items,'w'))
tot=collections.Counter(e['id'].split(':')[0] for e in dd)
win=collections.Counter(i['dataOriginId'].split(':')[0] for i in items)
print(f'rows={len(dd)} extracted-with-rows={len(ext)} anchor-pass-items={len(items)} anchor_fail={anchor_fail} already_written={already}')
print('per-brand yield (clean/total):')
for b in sorted(tot): print(f'  {b:26s} {win.get(b,0)}/{tot[b]}')
