#!/usr/bin/env python3
"""Build Brisa's public aggregate snapshot with Python standard library + curl."""
import argparse, collections, datetime, json, math, pathlib, subprocess, tempfile, urllib.parse
ROOT = pathlib.Path(__file__).resolve().parents[1]
BOUNDS = [-87.644, 41.866, -87.617, 41.891]
DX = 111320 * math.cos(math.radians(41.88)); DY = 111320
STEPX, STEPY = 250 / DX, 250 / DY
# Three grid cells on every side exceed the required 500 m halo.
NX = math.ceil((BOUNDS[2]-BOUNDS[0])/STEPX)+6
NY = math.ceil((BOUNDS[3]-BOUNDS[1])/STEPY)+6
WEST, SOUTH = BOUNDS[0]-3*STEPX, BOUNDS[1]-3*STEPY
HALO = [WEST,SOUTH,WEST+NX*STEPX,SOUTH+NY*STEPY]
SOURCE='https://data.cityofchicago.org/resource/ijzp-q8t2.json'
OSM='https://overpass-api.de/api/interpreter'
CATEGORIES={'ROBBERY':1,'THEFT':1,'ASSAULT':1,'BATTERY':1}
PLACES={'STREET','SIDEWALK','PARK PROPERTY','LAKEFRONT / WATERFRONT / RIVERBANK','BRIDGE','CTA BUS STOP'}
WHERE="date >= '2025-01-01T00:00:00' AND date < '2026-01-01T00:00:00' AND within_box(location, %s, %s, %s, %s)"%(HALO[3],HALO[0],HALO[1],HALO[2])
def fetch(url, target, data=None):
    # Never let an interrupted HTTP response become a reusable cache entry.
    temporary = tempfile.NamedTemporaryFile(prefix=target.name+'.', suffix='.part', dir=target.parent, delete=False)
    temporary.close()
    partial = pathlib.Path(temporary.name)
    cmd=['curl','--user-agent','BigRedHacks-demo/0.1 (https://github.com/hacv12/BigRedHacks)','--fail','--show-error','--silent','--retry','3','--max-time','180',url,'-o',str(partial)]
    if data: cmd += ['--data-urlencode','data='+data]
    try:
        subprocess.run(cmd,check=True)
        result=json.loads(partial.read_text())
        partial.replace(target)
        return result
    finally:
        partial.unlink(missing_ok=True)
def distance(a,b):
    return 6371000*2*math.asin(min(1,math.sqrt(math.sin(math.radians(b[1]-a[1])/2)**2+math.cos(math.radians(a[1]))*math.cos(math.radians(b[1]))*math.sin(math.radians(b[0]-a[0])/2)**2)))
def inside(p): return BOUNDS[0]<=p[0]<=BOUNDS[2] and BOUNDS[1]<=p[1]<=BOUNDS[3]
def graph(osm):
    nodes={}; edges=[]; excluded=collections.Counter()
    permitted={'footway','pedestrian','path','steps','living_street','residential','service','unclassified','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link'}
    for w in osm['elements']:
        if w['type']!='way': continue
        t=w.get('tags',{}); h=t.get('highway','')
        reason=None
        if h not in permitted: reason='highway class'
        elif t.get('access') in {'private','no','customers','delivery','permit','destination'}: reason='restricted access'
        elif t.get('foot') in {'no','private','customers','delivery','permit','destination','use_sidepath'}: reason='restricted foot'
        elif t.get('service')=='alley' or 'alley' in t.get('name','').lower(): reason='alley'
        elif t.get('area')=='yes' or t.get('indoor')=='yes' or t.get('construction'): reason='area/indoor/construction'
        if reason: excluded[reason]+=1; continue
        coords=[[p['lon'],p['lat']] for p in w['geometry']]
        for i,(a,b) in enumerate(zip(coords,coords[1:])):
            if not inside(a) or not inside(b) or distance(a,b)<0.1: continue
            na,nb=map(str,w['nodes'][i:i+2]);nodes[na]=a;nodes[nb]=b
            if t.get('oneway:foot')=='-1': na,nb,a,b=nb,na,b,a
            edges.append(dict(id=f"{w['id']}:{i}",from_=na,to=nb,coordinates=[a,b],meters=distance(a,b),name=t.get('name', 'Walking path' if h in {'footway','path','pedestrian'} else 'Steps' if h=='steps' else 'Unnamed street'),bidirectional=t.get('oneway:foot') not in {'yes','1','true','-1'}))
    adj=collections.defaultdict(set)
    for e in edges: adj[e['from_']].add(e['to']);adj[e['to']].add(e['from_'])
    remaining=set(nodes);components=[]
    while remaining:
        todo=[remaining.pop()]; comp=set(todo)
        while todo:
            for n in adj[todo.pop()]:
                if n in remaining: remaining.remove(n);comp.add(n);todo.append(n)
        components.append(comp)
    keep=max(components,key=len)
    edges=[{('from' if k=='from_' else k):v for k,v in e.items()} for e in edges if e['from_'] in keep]
    return [dict(id=k,point=v) for k,v in nodes.items() if k in keep],edges,dict(excluded),len(components)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--cache',default=str(ROOT/'.data-cache'));ap.add_argument('--osm-file');ap.add_argument('--refresh',action='store_true');args=ap.parse_args()
    cache=pathlib.Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
    def soda(params,name):
        p=cache/name
        if args.refresh: p.unlink(missing_ok=True)
        return json.loads(p.read_text()) if p.exists() else fetch(SOURCE+'?'+urllib.parse.urlencode(params),p)
    expected=int(soda({'$select':'count(*)','$where':WHERE},'count.json')[0]['count'])
    rows=[]
    for offset in range(0,expected,50000):
        rows+=soda({'$select':'id,date,primary_type,description,location_description,domestic,latitude,longitude','$where':WHERE,'$order':'id','$limit':50000,'$offset':offset},f'rows-{offset}.json')
    assert len(rows)==expected==len({r['id'] for r in rows}), 'Source count / unique rows mismatch'
    query=f'[out:json][timeout:120];way["highway"]({BOUNDS[1]},{BOUNDS[0]},{BOUNDS[3]},{BOUNDS[2]});out geom;'
    osmfile=pathlib.Path(args.osm_file) if args.osm_file else cache/'osm.json'
    if args.refresh and not args.osm_file: osmfile.unlink(missing_ok=True)
    osm=json.loads(osmfile.read_text()) if osmfile.exists() else fetch(OSM,osmfile,query)
    nodes,edges,graph_exclusions,components=graph(osm)
    counts=collections.defaultdict(lambda:[0]*4); exclusion=collections.Counter();missing=0
    for r in rows:
        if not r.get('latitude') or not r.get('longitude'): missing+=1;exclusion['missing coordinates']+=1;continue
        if r.get('primary_type') not in CATEGORIES: exclusion['other category']+=1;continue
        if r.get('domestic') is not False: exclusion['domestic or missing domestic flag']+=1;continue
        if r.get('location_description') not in PLACES: exclusion['other or missing place']+=1;continue
        if not r.get('date'): exclusion['missing date']+=1;continue
        x=int((float(r['longitude'])-WEST)/STEPX);y=int((float(r['latitude'])-SOUTH)/STEPY)
        assert 0<=x<NX and 0<=y<NY
        counts[x,y][int(r['date'][11:13])//6]+=1
    activity={}
    for x in range(NX):
        for y in range(NY):
            c=counts[x,y]; n=sum(c);a=n/(n+20)
            activity[x,y]=[a*4*v+(1-a)*n for v in c]
    # Cross kernel: center 1/2, cardinal neighbors 1/8 each; radius 250m.
    smooth={}
    for x,y in activity:
        neighbors=[(x,y,.5),(x-1,y,.125),(x+1,y,.125),(x,y-1,.125),(x,y+1,.125)]
        valid=[(a,b,w) for a,b,w in neighbors if (a,b) in activity];den=sum(w for a,b,w in valid)
        smooth[x,y]=[sum(activity[a,b][k]*w for a,b,w in valid)/den for k in range(4)]
    positive=sorted(v for c in smooth.values() for v in c if v>0);q=max(1,positive[math.ceil(.9*len(positive))-1])
    cells=[]
    for (x,y),values in smooth.items():
        w,s=WEST+x*STEPX,SOUTH+y*STEPY;c=counts[x,y]
        cells.append(dict(id=f'{x}:{y}',center=[w+STEPX/2,s+STEPY/2],bounds=[w,s,w+STEPX,s+STEPY],counts=c,weighted=c,intensity=[v/(v+q) for v in values],total=sum(c)))
    landmarks=[('union','Union Station',[-87.6405,41.8787]),('willis','Willis Tower',[-87.6359,41.8789]),('art','Art Institute',[-87.6249,41.8796]),('millennium','Millennium Park',[-87.6244,41.8826]),('library','Harold Washington Library',[-87.6280,41.8762]),('daley','Daley Plaza',[-87.6300,41.8848]),('river','Chicago Riverwalk',[-87.6295,41.8871]),('grant','Buckingham Fountain',[-87.6189,41.8758])]
    # Use verified closest graph points to avoid claiming access to building interiors.
    snaps=[]; result_landmarks=[]
    for i,name,p in landmarks:
        point=min(nodes,key=lambda n:distance(n['point'],p))['point'];d=distance(point,p)
        assert d<=75, f'{name} landmark snap too far: {d:.1f}m'
        snaps.append(f'{name}: {d:.1f}m');result_landmarks.append(dict(id=i,name=name,point=point))
    landmarks=result_landmarks
    eligible=sum(sum(c) for c in counts.values())
    manifest=dict(city='Chicago',district='Loop',timezone='America/Chicago',periodStart='2025-01-01',periodEnd='2025-12-31',downloadedAt=datetime.datetime.fromtimestamp((cache/'rows-0.json').stat().st_mtime,datetime.timezone.utc).isoformat(),sourceUrl='https://data.cityofchicago.org/Public-Safety/Crimes-2001-to-Present/ijzp-q8t2',osmSourceUrl=OSM,osmTimestamp=osm['osm3s']['timestamp_osm_base'],planningBounds=BOUNDS,incidentBounds=HALO,cellSizeMeters=250,sourceReportCount=expected,eligibleReportCount=eligible,excludedReportCount=expected-eligible,missingCoordinateCount=missing,categoryWeights=CATEGORIES,timeBuckets=['Midnight–6 am','6 am–noon','Noon–6 pm','6 pm–midnight'],modelVersion='brisa-250m-shrink20-cross-v2',normalization=q,notes=["Historical reported activity, not a probability of harm. Zero reports does not mean safe.","Chicago occurrence timestamps interpreted as local wall time, without UTC conversion.","All source categories fetched within halo; eligible: ROBBERY/THEFT/ASSAULT/BATTERY, domestic=false, place STREET/SIDEWALK/PARK PROPERTY/LAKEFRONT - WATERFRONT - RIVERBANK/BRIDGE/CTA BUS STOP; equal weights. Outdoor park, river, bridge and curbside reports align with permitted pedestrian graph paths; transit interiors remain excluded.","Spatial query necessarily excludes unlocated records; missingCoordinateCount covers fetched rows only, not citywide missing locations.","250m approximate local metric grid; shrink20, cross smoothing center .5/cardinal .125; fixed nearest-rank p90 positive activity normalization.","All halo cells bundled including zeros. Outer halo smoothing renormalizes available neighbors; planning area has full smoothing support.","OSM way-level walking tags are not a sidewalk/crosswalk accessibility audit; node barrier/access tags are not retrieved. Landmarks are nearby graph access points.","OpenStreetMap contributors, ODbL 1.0; https://www.openstreetmap.org/copyright",'Landmark access-point snaps: '+ '; '.join(snaps),'Exclusions (first matching rule): '+json.dumps(dict(exclusion),sort_keys=True),'OSM excluded ways: '+json.dumps(graph_exclusions,sort_keys=True),f'Kept largest of {components} undirected graph components.'])
    result=dict(manifest=manifest,nodes=nodes,edges=edges,cells=cells,landmarks=landmarks)
    (ROOT/'public/data/chicago-loop.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    print(json.dumps(dict(source=expected,eligible=eligible,excluded=dict(exclusion),nodes=len(nodes),edges=len(edges),cells=len(cells),normalization=q),indent=2))
if __name__=='__main__': main()
