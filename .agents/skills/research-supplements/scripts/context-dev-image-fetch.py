#!/usr/bin/env python3
# fetch_batch.py <batch_tag> <start> <count> — fetch+select images for a pool slice
#
# Scrapes each row's product page via context.dev (markdown + images), then SELECTS the
# facts-panel image(s) and downloads them for a downstream vision-OCR pass.
#
# TWO HARD-WON LESSONS BAKED IN — do not remove:
#  1. RATE GATE (gate()): context.dev caps ~120 req/min. 8 unthrottled workers trip it and
#     ~60% of scrapes silently return scrape_error. The 0.55s global gate (~109/min) fixes it.
#     Without it a whole pool looks "image-less" when it's really just rate-limited.
#  2. SELECTOR scoring (candidates()): the facts panel is often identified by ALT TEXT
#     ("Supplement Facts", "Amount Per Serving") or an SFP/_sf filename, NOT the product name.
#     Score alt-text highest (+8), then facts filename (+4), keep top-6. Filename-only scoring
#     misses ~80% of panels.
import json, sys, os, re, urllib.request, urllib.parse, time, threading, subprocess
from concurrent.futures import ThreadPoolExecutor
sys.argv_tag, start, count = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
TAG=sys.argv_tag
CKEY=next(l.split('=',1)[1].strip().strip('"').strip("'") for l in open('/Users/willhay/startup1/murph/.env') if l.startswith('CONTEXT_DEV_API_KEY='))
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
IMGDIR=f"/tmp/murph-supplement-audit/img_{TAG}"; os.makedirs(IMGDIR,exist_ok=True)
EXCLUDE=re.compile(r'(logo|icon|banner|menu|thumbnail|thumb|badge|sprite|flag|payment|favicon|placeholder|\.svg|_96x|_100x|_small|bestseller|what.?s.?new)',re.I)
FACTS_FN=re.compile(r'(supp_?fact|suppfacts|_sfp?[_.]|[_-]sfp?[_.]|sfp_|_sfp|supplement.?facts|nutrition.?facts|_b?back|_bfront|_panel|_nutrition|ingredient|_label|_facts?[_.])',re.I)
FACTS_ALT=re.compile(r'(serving size|servings per|amount per serving|supplement facts|nutrition facts|daily value|%\s*dv|% daily)',re.I)
STOP=set('the and for with plus advanced complex supplement capsules tablets softgels veggie vegetable count high potency formula softgel caplets liquid powder bottle servings one mg mcg iu oz size'.split())
def ntoks(name): return [t for t in re.sub(r'[^a-z0-9 ]',' ',(name or '').lower()).split() if len(t)>3 and t not in STOP and not t.isdigit()]
def candidates(md,name):
    pairs=re.findall(r'!\[([^\]]*)\]\((https?://[^)\s]+)\)',md); nt=ntoks(name); seen=set(); scored=[]
    for alt,u in pairs:
        base=u.split('?')[0]
        if base in seen or EXCLUDE.search(u): continue
        seen.add(base); fn=base.split('/')[-1].lower(); altl=(alt or '').lower()
        nm=any(t in altl or t in fn for t in nt) if nt else True
        s=(8 if FACTS_ALT.search(altl) else 0)+(4 if FACTS_FN.search(fn) else 0)+(2 if nm else 0)+(1 if re.search(r'(_2[_.]|_3[_.]|-2\.|-3\.)',fn) else 0)
        scored.append((s,u))
    scored.sort(key=lambda x:-x[0])
    top=[u for s,u in scored if s>0 or not nt][:6]
    return top or [u for _,u in scored[:3]]
def get(url,t=3):
    for a in range(t):
        try: return urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":UA}),timeout=60).read()
        except Exception:
            if a==t-1: raise
            time.sleep(1)
lock=threading.Lock(); manifest=[]
_rl=threading.Lock(); _last=[0.0]
def gate():
    with _rl:
        w=_last[0]+0.55-time.monotonic()
        if w>0: time.sleep(w)
        _last[0]=time.monotonic()
def process(row):
    did,url=row['id'],row['url']; safe=re.sub(r'[^a-z0-9]+','_',did.lower())
    gate()
    try:
        q=urllib.parse.urlencode({"url":url,"useMainContentOnly":"false","includeImages":"true"})
        md=json.loads(urllib.request.urlopen(urllib.request.Request(f"https://api.context.dev/v1/web/scrape/markdown?{q}",headers={"Authorization":f"Bearer {CKEY}","User-Agent":UA}),timeout=120).read()).get("markdown","")
    except Exception:
        with lock: manifest.append({"id":did,"status":"scrape_error"}); return
    paths=[]
    for n,iu in enumerate(candidates(md,row.get('name',''))):
        try:
            raw=get(iu)
            if len(raw)>4_500_000 or len(raw)<2000: continue
            ext="png" if iu.split('?')[0].lower().endswith("png") else "jpg"
            p=f"{IMGDIR}/{safe}_{n}.{ext}"; open(p,"wb").write(raw); paths.append(p)
        except Exception: continue
    with lock: manifest.append({"id":did,"status":"ok" if paths else "no_images","images":paths,"name":row.get('name'),"brand":row.get('brand'),"upc":row.get('upc'),"offMarket":row.get('offMarket'),"url":url})
pool=json.load(open('/tmp/murph-supplement-audit/ocr_remaining_pool.json'))[start:start+count]
# enrich with metadata
DB_URL=next(l.split('=',1)[1].strip() for l in open('/Users/willhay/startup1/murph/.env.local') if l.startswith('MURPH_SUPPLEMENT_DB_URL='))
ids=[r['id'] for r in pool]; meta={}
for i in range(0,len(ids),300):
    il=",".join("'"+x.replace("'","''")+"'" for x in ids[i:i+300])
    sql=f"SELECT json_agg(json_build_object('id',data_origin_id,'name',name,'brand',brand,'upc',upc,'offMarket',off_market)) FROM supplements WHERE data_origin='brand_site' AND data_origin_id IN ({il});"
    for r in json.loads(subprocess.run(['psql',DB_URL,'-t','-A','-c',sql],capture_output=True,text=True).stdout): meta[r['id']]=r
for r in pool: r.update({k:meta.get(r['id'],{}).get(k) for k in ('name','brand','upc','offMarket')})
print(f"{TAG}: fetching {len(pool)} rows",flush=True)
with ThreadPoolExecutor(max_workers=8) as ex: list(ex.map(process,pool))
json.dump(manifest,open(f'/tmp/murph-supplement-audit/manifest_{TAG}.json','w'))
import collections; print(TAG,"status:",dict(collections.Counter(m['status'] for m in manifest)),"with_images:",sum(1 for m in manifest if m.get('images')),flush=True)
# chunk
cd=f'/tmp/murph-supplement-audit/chunks_{TAG}'; os.makedirs(cd,exist_ok=True)
withimg=[m for m in manifest if m.get('images')]; n=0
for i in range(0,len(withimg),5):
    json.dump([{'id':r['id'],'name':r['name'],'brand':r['brand'],'images':r['images']} for r in withimg[i:i+5]],open(f'{cd}/chunk_{n:02d}.json','w')); n+=1
print(TAG,"chunks:",n,flush=True)
