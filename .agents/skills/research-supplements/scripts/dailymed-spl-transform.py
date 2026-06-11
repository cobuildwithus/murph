#!/usr/bin/env python3
"""dailymed-spl-transform.py [--write] — structure the dailymed origin from its own SPL data.

DailyMed rows are NOT a scraping problem: each row's `label.ingredients` is already a fully
structured FDA SPL array ({name, quantity:{amount,unit,denominatorAmount,denominatorUnit},
classCode}). They land unstructured only because that array was never mapped into the
`ingredientRows` / `servingSizes` shape the app reads. This is a PURE DETERMINISTIC transform —
no context.dev, no vision, no LLM, ~zero compute.

Mapping:
  - active ingredients (classCode ACTIB | ACTIM | ACTIR) -> ingredientRows
      (ACTIB/ACTIM/ACTIR are DISTINCT actives per product here, not base/moiety duplicates of
       each other — verified across the corpus — so include all three, deduped by name+amount.)
  - inactive ingredients (classCode IACT)               -> otherIngredientRows (names only)
  - serving size: weight/volume denominator used directly (e.g. "15 mL", "20 g"); a per-unit
      denominator ("1 1") -> dosage form parsed from the SPL title ("1 Tablet"); "1 serving"
      when the title carries no form word (~half the corpus — the per-unit amount is what matters).
  - units normalized: ug->mcg, [iU]->IU, [CFU]->CFU, [USP'U]->USP Units, meq->mEq.

Applies the same food / non-standalone production guards as the brand_site path, so combo-packs
and foods are held back rather than surfaced. Writes via an in-place `label || patch` jsonb merge
keyed on (data_origin='dailymed', data_origin_id); the existing search_text already carries the
ingredient names, so it is left untouched. Dry-run (no --write) prints guard counts + 5 samples.
"""
import json, subprocess, os, re, sys, collections

DB=next(l.split('=',1)[1].strip() for l in open('/Users/willhay/startup1/murph/.env.local') if l.startswith('MURPH_SUPPLEMENT_DB_URL='))
WRITE='--write' in sys.argv

UNIT={'ug':'mcg','[iU]':'IU','[CFU]':'CFU',"[USP'U]":'USP Units','meq':'mEq','umol':'umol','mg':'mg','g':'g','mL':'mL','L':'L','1':''}
FORM=re.compile(r'\b(TABLET|CAPSULE|SOFTGEL|CAPLET|GUMMY|GUMMIES|LOZENGE|POWDER|LIQUID|SOLUTION|SUSPENSION|GRANULE|WAFER|FILM|SPRAY|CHEWABLE|TROCHE|PASTILLE)S?\b', re.I)

ACRONYMS={'DHA','EPA','ALA','GLA','CFU','IU','NADH','COQ10','MSM','NAC','GABA','MCT','MCTS','USP','PABA','SAME','DIM','EGCG','HTP','TMG','DMAE','CLA','SOD','HCL','DL','D3','D2','K1','K2','B1','B2','B3','B5','B6','B12','C','D','E','K','A','PQQ','TUDCA','UDCA','MK7','MK4','GTF','ATP','RNA','DNA'}
def cap_word(w):
    if not any(c.isalpha() for c in w): return w  # numbers/symbols untouched
    if w.upper() in ACRONYMS: return w.upper()
    if '-' in w:  # hyphenated chemical token: capitalize each non-empty alpha sub-part
        return '-'.join(p.upper() if p.upper() in ACRONYMS else (p[:1].upper()+p[1:].lower() if p[:1].isalpha() else p)
                        for p in w.split('-') if p)
    return w[:1].upper()+w[1:].lower()
def clean_name(n):
    n=(n or '').strip()
    n=re.sub(r',\s*UNSPECIFIED\s*$','',n,flags=re.I)  # strip SPL ", UNSPECIFIED" suffix
    n=n.replace('.ALPHA.','Alpha-').replace('.BETA.','Beta-').replace('.GAMMA.','Gamma-').replace('.DELTA.','Delta-')
    m=re.match(r'^(.*),\s*(DL|D|L|D-ALPHA|R|S)-?$', n, re.I)  # "X, DL-" -> "DL-X"
    if m: n=f"{m.group(2)}-{m.group(1)}"
    n=re.sub(r'-{2,}','-',n).strip('-')  # collapse double-hyphens from the .ALPHA. substitution
    return ' '.join(cap_word(w) for w in n.split()).strip()

def serving_from(denomA, denomU, title):
    if denomU and denomU not in ('1',) and denomA:        # weight/volume denominator -> use directly
        amt=denomA.rstrip('.0') or denomA
        return f"{amt} {denomU}"
    m=FORM.search(title or '')                            # per-unit -> derive dosage form from title
    if m:
        form={'gummies':'gummy'}.get(m.group(1).lower(),m.group(1).lower()).capitalize()
        n=denomA if (denomA and denomA not in ('1','1.0')) else '1'
        try: plural='s' if float(denomA or 1)>1 else ''
        except: plural=''
        return f"{n} {form}{plural}"
    return "1 serving"

def transform(ings, title):
    rows=[]; other=[]; seen=set()
    for i in ings:
        cc=i.get('classCode'); nm=clean_name(i.get('name'))
        if not nm: continue
        if cc in ('ACTIB','ACTIM','ACTIR'):
            q=i.get('quantity') or {}
            amt=str(q.get('amount','')).strip()
            unit=UNIT.get(q.get('unit'), q.get('unit') or '')
            key=(nm.lower(),amt,unit)
            if key in seen: continue
            seen.add(key)
            rows.append({'name':nm,'amount':amt,'unit':unit,'dailyValue':'','source':'dailymed_spl'})
        elif cc=='IACT':
            if nm.lower() not in {o['name'].lower() for o in other}:
                other.append({'name':nm,'source':'dailymed_spl'})
    sv=None
    for i in ings:
        if i.get('classCode') in ('ACTIB','ACTIM','ACTIR'):
            q=i.get('quantity') or {}
            sv=serving_from(str(q.get('denominatorAmount','') or ''), q.get('denominatorUnit') or '', title)
            break
    servingSizes=[{'text':sv,'source':'dailymed_spl'}] if sv else []
    return rows, servingSizes, other

# --- production guards (same intent as labels.mjs findProductionReviewIssues) ---
NONSTANDALONE=re.compile(r'\b(bundle|kit|regimen|combo pack|variety pack|support plan|supplement plan|multi[-\s]?pack)\b|\b(sample|promo)\b|\b[2-9]\s*[- ]?\s*pack\b|\b[2-9]\s+(?:bottles?|jars?|containers?|boxes?)\b', re.I)
FOOD=re.compile(r'\b(?:snacks?|protein\s+bars?|nutrition\s+bars?|energy\s+bars?|meal\s+(?:replacement\s+)?bars?|ready[-\s]?to[-\s]?(?:eat|drink)|rtd\s+(?:drink|shake|beverage)|protein\s+cookies?|cookies?|brownies?|chips?|crisps?|candy|granola|muesli)\b', re.I)
def flags(item):
    lab=item['label']
    hay=' '.join(str(x) for x in [item['dataOriginId'],item.get('dataOriginUrl'),item['name'],lab.get('title')] if x).lower()
    f=[]
    if NONSTANDALONE.search(hay): f.append('non_standalone')
    if FOOD.search(hay): f.append('food')
    if len(' '.join(str(x) for x in [item['name'],item['brand'],lab.get('title')] if x))>6000: f.append('search_text_too_large')
    return f

def main():
    sql="SELECT json_agg(row_to_json(s)) FROM (SELECT data_origin_id, name, brand, upc, data_origin_url, label FROM supplements WHERE data_origin='dailymed') s"
    rows=json.loads(subprocess.run(['psql',DB,'-t','-A','-c',sql],capture_output=True,text=True).stdout.strip())
    items=[]; skipped=0; flagged=[]
    for r in rows:
        lab=r['label'] or {}; ings=lab.get('ingredients') or []
        ir, sv, other = transform(ings, lab.get('title',''))
        if not ir or not sv: skipped+=1; continue
        did=r['data_origin_id']
        it={'id':did,'dataOriginId':did,'dataOriginUrl':r['data_origin_url'],'name':r['name'],'brand':r['brand'],
            'label':{'title':lab.get('title'),'evidenceStatus':'dailymed_spl',
                'ingredientRows':ir,'servingSizes':sv,**({'otherIngredientRows':other} if other else {})}}
        fl=flags(it)
        if fl: flagged.append((did,fl)); continue
        items.append(it)
    print(f"production-ready: {len(items)} | flagged (skipped): {len(flagged)} | no-active/serving: {skipped}")
    print(f"flag breakdown: {dict(collections.Counter(f for _,fs in flagged for f in fs))}")

    if WRITE:
        n=0
        for it in items:
            lab=it['label']
            patch=json.dumps({'evidenceStatus':'dailymed_spl','ingredientRows':lab['ingredientRows'],
                'servingSizes':lab['servingSizes'],**({'otherIngredientRows':lab['otherIngredientRows']} if 'otherIngredientRows' in lab else {})})
            q="UPDATE supplements SET label = label || '"+patch.replace("'","''")+"'::jsonb WHERE data_origin='dailymed' AND data_origin_id='"+it['dataOriginId'].replace("'","''")+"'"
            subprocess.run(['psql',DB,'-c',q],capture_output=True,text=True); n+=1
        print(f"updated {n} dailymed rows in place")
    else:
        import random; random.seed(7)
        print(f"\n(dry-run — pass --write to apply)\n")
        for s in random.sample(items, min(5,len(items))):
            print('='*70); print(s['name'],'|',s['brand'])
            print('  serving:', [x['text'] for x in s['label']['servingSizes']])
            for ir in s['label']['ingredientRows'][:8]:
                print(f"    {ir['name'][:42]:44s} {ir['amount']} {ir['unit']}")
            oi=s['label'].get('otherIngredientRows',[])
            if oi: print('  other:', ', '.join(o['name'] for o in oi[:6]), '...' if len(oi)>6 else '')

if __name__=='__main__': main()
